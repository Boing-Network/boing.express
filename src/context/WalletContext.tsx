import React, { createContext, useCallback, useContext, useState, useEffect, useRef, useLayoutEffect } from 'react';
import type { AccountId } from '../boing/types';
import type { NetworkAdapter } from '../networks/types';
import {
  getDefaultNetwork,
  getNetwork,
  DEFAULT_NETWORK_ID,
} from '../networks';
import { createBoingAdapter } from '../networks/boingAdapter';
import type { BoingNetworksMeta } from '../networks/boingMeta';
import { normalizeHttpsUrl } from '../networks/boingMeta';
import { getInitialWebNetworkCatalog, refreshWebNetworkCatalog } from '../networks/refreshWebNetworkCatalog';
import { getRpcOverrides, setRpcOverride as saveRpcOverride } from '../storage/rpcOverride';
import {
  hasStoredWallet,
  unlockWallet,
  createAndSaveWallet,
  importAndSaveWallet,
  clearWallet,
  getStoredWallet,
  listAccountSummaries,
  setActiveAccountIndex,
  getActiveAccountIndex,
  createAdditionalAccount,
  importAdditionalAccount,
  createWalletWithPhrase as storeCreateWalletWithPhrase,
  importWalletFromPhrase as storeImportWalletFromPhrase,
} from '../storage/walletStore';
import { saveSession, clearSession, getSession, touchSession } from '../storage/sessionStore';
import {
  getLockAfterMinutes,
  setLockAfterMinutes as persistLockAfterMinutes,
  type LockAfterMinutes,
} from '../storage/lockSettings';

interface WalletState {
  accountId: AccountId | null;
  privateKey: Uint8Array | null;
  network: NetworkAdapter;
  isUnlocked: boolean;
}

export type NetworkDiscoveryInfo = {
  status: 'idle' | 'loading' | 'ok' | 'error';
  errorMessage: string | null;
  meta: BoingNetworksMeta | null;
  updatedAt: number | null;
  /** True when the latest refresh got a live HTTP response with meta. */
  fetchedLive: boolean;
  /** True when live fetch failed or returned empty but an older cache was used. */
  usedStaleCache: boolean;
  /** Last refresh skipped HTTP because local cache was still fresh. */
  skippedLiveFetch: boolean;
  refresh: () => Promise<void>;
  bootnodeCount: number;
  officialWebsiteUrl: string | null;
};

type WalletContextValue = WalletState & {
  hasWallet: boolean;
  storedAddressHint: string | null;
  network: NetworkAdapter;
  /** Networks after Boing /api/networks merge (before per-network RPC overrides). */
  availableNetworks: NetworkAdapter[];
  setNetwork: (id: string) => void;
  rpcOverrides: Record<string, string>;
  setRpcOverride: (networkId: string, url: string) => void;
  unlock: (password: string) => Promise<void>;
  createWallet: (password: string) => Promise<{ privateKeyHex: string }>;
  importWallet: (password: string, privateKeyHex: string) => Promise<void>;
  /** Append account to vault; returns backup key for the new keypair. */
  createAnotherAccount: (password: string) => Promise<{ privateKeyHex: string }>;
  /** Append imported account and unlock it (same password). */
  importAnotherAccount: (password: string, privateKeyHex: string) => Promise<void>;
  /** New account from a fresh recovery phrase (24 words). `additional` appends to the existing vault. */
  createWalletWithPhrase: (password: string, additional?: boolean) => Promise<{ phrase: string }>;
  /** Restore from a 12- or 24-word recovery phrase and unlock. */
  importWalletFromPhrase: (password: string, phrase: string, additional?: boolean) => Promise<void>;
  lock: () => void;
  logout: () => void;
  getPrivateKey: () => Uint8Array | null;
  lockAfterMinutes: LockAfterMinutes;
  setLockAfterMinutes: (value: LockAfterMinutes) => void;
  networkDiscovery: NetworkDiscoveryInfo;
  /** Multi-account vault (same storage as extension). */
  accountList: ReturnType<typeof listAccountSummaries>;
  activeAccountIndex: number;
  /** Switch active account; clears unlock — user must enter password again on Welcome. */
  switchVaultAccount: (index: number) => void;
};

const WalletContext = createContext<WalletContextValue | null>(null);

function resolveNetwork(base: NetworkAdapter, overrides: Record<string, string>): NetworkAdapter {
  const url = overrides[base.config.id];
  if (url) {
    return createBoingAdapter({ ...base.config, rpcUrl: url });
  }
  return base;
}

function emptyDiscovery(refresh: () => Promise<void>): NetworkDiscoveryInfo {
  return {
    status: 'idle',
    errorMessage: null,
    meta: null,
    updatedAt: null,
    fetchedLive: false,
    usedStaleCache: false,
    skippedLiveFetch: false,
    refresh,
    bootnodeCount: 0,
    officialWebsiteUrl: null,
  };
}

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [networksCatalog, setNetworksCatalog] = useState<NetworkAdapter[]>(() => getInitialWebNetworkCatalog());
  const networksCatalogRef = useRef(networksCatalog);
  networksCatalogRef.current = networksCatalog;

  const refreshNetworkCatalogRef = useRef<() => Promise<void>>(async () => {});

  const [discovery, setDiscovery] = useState<NetworkDiscoveryInfo>(() =>
    emptyDiscovery(() => refreshNetworkCatalogRef.current())
  );

  const refreshNetworkCatalog = useCallback(async () => {
    setDiscovery((d) => ({
      ...d,
      status: 'loading',
      errorMessage: null,
    }));
    try {
      const { catalog, meta, fetchedLive, usedStaleCache, skippedLiveFetch } =
        await refreshWebNetworkCatalog();
      setNetworksCatalog(catalog);
      const website = normalizeHttpsUrl(meta?.ecosystem?.website_url);
      setDiscovery({
        status: 'ok',
        errorMessage: null,
        meta,
        updatedAt: Date.now(),
        fetchedLive,
        usedStaleCache,
        skippedLiveFetch,
        refresh: () => refreshNetworkCatalogRef.current(),
        bootnodeCount: Array.isArray(meta?.official_bootnodes) ? meta!.official_bootnodes!.length : 0,
        officialWebsiteUrl: website || null,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setDiscovery((d) => ({
        ...d,
        status: 'error',
        errorMessage: msg,
        refresh: () => refreshNetworkCatalogRef.current(),
      }));
    }
  }, []);

  useLayoutEffect(() => {
    refreshNetworkCatalogRef.current = refreshNetworkCatalog;
  });

  useEffect(() => {
    void refreshNetworkCatalog();
  }, [refreshNetworkCatalog]);

  const [rpcOverrides, setRpcOverridesState] = useState<Record<string, string>>(() => getRpcOverrides());
  const [state, setState] = useState<WalletState>(() => ({
    accountId: null,
    privateKey: null,
    network: getDefaultNetwork(getInitialWebNetworkCatalog()),
    isUnlocked: false,
  }));
  const [lockAfterMinutes, setLockAfterMinutesState] = useState<LockAfterMinutes>(() => getLockAfterMinutes());
  const [vaultRev, setVaultRev] = useState(0);
  const inactivityTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const bumpVault = useCallback(() => setVaultRev((n) => n + 1), []);

  useEffect(() => {
    setState((s) => {
      const id = s.network.config.id;
      const fresh = getNetwork(id, networksCatalog) ?? getDefaultNetwork(networksCatalog);
      if (
        fresh.config.rpcUrl === s.network.config.rpcUrl &&
        fresh.config.explorerUrl === s.network.config.explorerUrl &&
        fresh.config.faucetUrl === s.network.config.faucetUrl &&
        fresh.config.id === s.network.config.id
      ) {
        return s;
      }
      return { ...s, network: fresh };
    });
  }, [networksCatalog]);

  useEffect(() => {
    // The unlocked key is sealed under a non-extractable WebCrypto key (see storage/sessionStore.ts); restoring is async.
    let cancelled = false;
    void getSession({ lockAfterMinutes: getLockAfterMinutes() }).then((session) => {
      if (cancelled || !session) return;
      if (!hasStoredWallet()) {
        clearSession();
        return;
      }
      setState((s) => ({
        ...s,
        accountId: session.publicKey,
        privateKey: session.privateKey,
        isUnlocked: true,
      }));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const resolvedNetwork = resolveNetwork(state.network, rpcOverrides);

  const setRpcOverride = useCallback((networkId: string, url: string) => {
    saveRpcOverride(networkId, url);
    setRpcOverridesState({ ...getRpcOverrides() });
  }, []);

  const hasWallet = hasStoredWallet();
  void vaultRev;
  const stored = getStoredWallet();
  const storedAddressHint = stored ? `${stored.addressHex.slice(0, 8)}…${stored.addressHex.slice(-8)}` : null;
  const accountList = listAccountSummaries();
  const activeAccountIndex = getActiveAccountIndex();

  const setNetwork = useCallback((id: string) => {
    const n = getNetwork(id, networksCatalogRef.current);
    if (n) setState((s) => ({ ...s, network: n }));
  }, []);

  const unlock = useCallback(async (password: string) => {
    const [publicKey, privateKey] = await unlockWallet(password);
    await saveSession(publicKey, privateKey);
    setState((s) => ({
      ...s,
      accountId: publicKey,
      privateKey,
      isUnlocked: true,
    }));
  }, []);

  const createWallet = useCallback(async (password: string) => {
    const { privateKeyHex } = await createAndSaveWallet(password);
    bumpVault();
    return { privateKeyHex };
  }, [bumpVault]);

  const importWallet = useCallback(async (password: string, privateKeyHex: string) => {
    await importAndSaveWallet(password, privateKeyHex);
    bumpVault();
    const [publicKey, privateKey] = await unlockWallet(password);
    await saveSession(publicKey, privateKey);
    setState((s) => ({
      ...s,
      accountId: publicKey,
      privateKey,
      isUnlocked: true,
    }));
  }, [bumpVault]);

  const createAnotherAccount = useCallback(
    async (password: string) => {
      const { privateKeyHex } = await createAdditionalAccount(password);
      bumpVault();
      return { privateKeyHex };
    },
    [bumpVault]
  );

  const importAnotherAccount = useCallback(
    async (password: string, privateKeyHex: string) => {
      await importAdditionalAccount(password, privateKeyHex);
      bumpVault();
      const [publicKey, privateKey] = await unlockWallet(password);
      await saveSession(publicKey, privateKey);
      setState((s) => ({
        ...s,
        accountId: publicKey,
        privateKey,
        isUnlocked: true,
      }));
    },
    [bumpVault]
  );

  const createWalletWithPhrase = useCallback(
    async (password: string, additional = false) => {
      const { phrase } = await storeCreateWalletWithPhrase(password, additional);
      bumpVault();
      return { phrase };
    },
    [bumpVault]
  );

  const importWalletFromPhrase = useCallback(
    async (password: string, phrase: string, additional = false) => {
      await storeImportWalletFromPhrase(password, phrase, additional);
      bumpVault();
      const [publicKey, privateKey] = await unlockWallet(password);
      await saveSession(publicKey, privateKey);
      setState((s) => ({
        ...s,
        accountId: publicKey,
        privateKey,
        isUnlocked: true,
      }));
    },
    [bumpVault]
  );

  const setLockAfterMinutes = useCallback((value: LockAfterMinutes) => {
    persistLockAfterMinutes(value);
    setLockAfterMinutesState(value);
  }, []);

  const lock = useCallback(() => {
    clearSession();
    setState((s) => ({
      ...s,
      accountId: null,
      privateKey: null,
      isUnlocked: false,
    }));
  }, []);

  const switchVaultAccount = useCallback(
    (index: number) => {
      setActiveAccountIndex(index);
      clearSession();
      setState((s) => ({
        ...s,
        accountId: null,
        privateKey: null,
        isUnlocked: false,
      }));
      bumpVault();
    },
    [bumpVault]
  );

  useEffect(() => {
    if (!state.isUnlocked || lockAfterMinutes === 0) {
      if (inactivityTimeoutRef.current) {
        clearTimeout(inactivityTimeoutRef.current);
        inactivityTimeoutRef.current = null;
      }
      return;
    }
    const scheduleLock = () => {
      if (inactivityTimeoutRef.current) clearTimeout(inactivityTimeoutRef.current);
      inactivityTimeoutRef.current = setTimeout(() => {
        inactivityTimeoutRef.current = null;
        lock();
      }, lockAfterMinutes * 60 * 1000);
    };
    scheduleLock();
    const onActivity = () => {
      scheduleLock();
      touchSession();
    };
    document.addEventListener('click', onActivity);
    document.addEventListener('keydown', onActivity);
    return () => {
      document.removeEventListener('click', onActivity);
      document.removeEventListener('keydown', onActivity);
      if (inactivityTimeoutRef.current) {
        clearTimeout(inactivityTimeoutRef.current);
        inactivityTimeoutRef.current = null;
      }
    };
  }, [state.isUnlocked, lockAfterMinutes, lock]);

  const logout = useCallback(() => {
    clearSession();
    clearWallet();
    bumpVault();
    setState((s) => {
      const catalog = networksCatalogRef.current;
      const id = s.network.config.id;
      return {
        accountId: null,
        privateKey: null,
        isUnlocked: false,
        network: getNetwork(id, catalog) ?? getDefaultNetwork(catalog),
      };
    });
  }, [bumpVault]);

  const getPrivateKey = useCallback(() => state.privateKey, [state.privateKey]);

  const value: WalletContextValue = {
    ...state,
    network: resolvedNetwork,
    hasWallet,
    storedAddressHint,
    availableNetworks: networksCatalog,
    setNetwork,
    rpcOverrides,
    setRpcOverride,
    unlock,
    createWallet,
    importWallet,
    createAnotherAccount,
    importAnotherAccount,
    createWalletWithPhrase,
    importWalletFromPhrase,
    lock,
    logout,
    getPrivateKey,
    lockAfterMinutes,
    setLockAfterMinutes,
    networkDiscovery: discovery,
    accountList,
    activeAccountIndex,
    switchVaultAccount,
  };

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet(): WalletContextValue {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error('useWallet must be used within WalletProvider');
  return ctx;
}

export { DEFAULT_NETWORK_ID };
