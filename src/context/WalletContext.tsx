import React, { createContext, useCallback, useContext, useState, useEffect, useRef } from 'react';
import type { AccountId } from '../boing/types';
import type { NetworkAdapter } from '../networks/types';
import {
  getDefaultNetwork,
  getNetwork,
  NETWORKS,
  DEFAULT_NETWORK_ID,
} from '../networks';
import { createBoingAdapter } from '../networks/boingAdapter';
import { getRpcOverrides, setRpcOverride as saveRpcOverride } from '../storage/rpcOverride';
import {
  hasStoredWallet,
  unlockWallet,
  createAndSaveWallet,
  importAndSaveWallet,
  clearWallet,
  getStoredWallet,
} from '../storage/walletStore';
import { saveSession, clearSession, getSession } from '../storage/sessionStore';
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

const defaultState: WalletState = {
  accountId: null,
  privateKey: null,
  network: getDefaultNetwork(),
  isUnlocked: false,
};

type WalletContextValue = WalletState & {
  hasWallet: boolean;
  storedAddressHint: string | null;
  network: NetworkAdapter; // resolved (with RPC override if set)
  setNetwork: (id: string) => void;
  rpcOverrides: Record<string, string>;
  setRpcOverride: (networkId: string, url: string) => void;
  unlock: (password: string) => Promise<void>;
  createWallet: (password: string) => Promise<{ privateKeyHex: string }>;
  importWallet: (password: string, privateKeyHex: string) => Promise<void>;
  lock: () => void;
  logout: () => void;
  getPrivateKey: () => Uint8Array | null;
  lockAfterMinutes: LockAfterMinutes;
  setLockAfterMinutes: (value: LockAfterMinutes) => void;
};

const WalletContext = createContext<WalletContextValue | null>(null);

function resolveNetwork(base: NetworkAdapter, overrides: Record<string, string>): NetworkAdapter {
  const url = overrides[base.config.id];
  if (url) {
    return createBoingAdapter({ ...base.config, rpcUrl: url });
  }
  return base;
}

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [rpcOverrides, setRpcOverridesState] = useState<Record<string, string>>(() => getRpcOverrides());
  const [state, setState] = useState<WalletState>(() => ({
    ...defaultState,
    network: getDefaultNetwork(),
  }));
  const [lockAfterMinutes, setLockAfterMinutesState] = useState<LockAfterMinutes>(() => getLockAfterMinutes());
  const inactivityTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Restore session from sessionStorage on mount (same-tab refresh/navigation).
  useEffect(() => {
    const session = getSession();
    if (session && hasStoredWallet()) {
      setState((s) => ({
        ...s,
        accountId: session.publicKey,
        privateKey: session.privateKey,
        isUnlocked: true,
      }));
    }
  }, []);

  const resolvedNetwork = resolveNetwork(state.network, rpcOverrides);

  const setRpcOverride = useCallback((networkId: string, url: string) => {
    saveRpcOverride(networkId, url);
    setRpcOverridesState({ ...getRpcOverrides() });
  }, []);

  const hasWallet = hasStoredWallet();
  const stored = getStoredWallet();
  const storedAddressHint = stored ? `${stored.addressHex.slice(0, 8)}…${stored.addressHex.slice(-8)}` : null;

  const setNetwork = useCallback((id: string) => {
    const n = getNetwork(id);
    if (n) setState((s) => ({ ...s, network: n }));
  }, []);

  const unlock = useCallback(async (password: string) => {
    const [publicKey, privateKey] = await unlockWallet(password);
    saveSession(publicKey, privateKey);
    setState((s) => ({
      ...s,
      accountId: publicKey,
      privateKey,
      isUnlocked: true,
    }));
  }, []);

  const createWallet = useCallback(async (password: string) => {
    const { privateKeyHex } = await createAndSaveWallet(password);
    return { privateKeyHex };
  }, []);

  const importWallet = useCallback(async (password: string, privateKeyHex: string) => {
    await importAndSaveWallet(password, privateKeyHex);
    const [publicKey, privateKey] = await unlockWallet(password);
    saveSession(publicKey, privateKey);
    setState((s) => ({
      ...s,
      accountId: publicKey,
      privateKey,
      isUnlocked: true,
    }));
  }, []);

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

  // Inactivity timeout: auto-lock after N minutes when unlocked. Reset on user activity.
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
    const onActivity = () => scheduleLock();
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
    setState({
      ...defaultState,
      network: getNetwork(state.network.config.id) ?? getDefaultNetwork()
    });
  }, [state.network.config.id]);

  const getPrivateKey = useCallback(() => state.privateKey, [state.privateKey]);

  const value: WalletContextValue = {
    ...state,
    network: resolvedNetwork,
    hasWallet,
    storedAddressHint,
    setNetwork,
    rpcOverrides,
    setRpcOverride,
    unlock,
    createWallet,
    importWallet,
    lock,
    logout,
    getPrivateKey,
    lockAfterMinutes,
    setLockAfterMinutes,
  };

  return (
    <WalletContext.Provider value={value}>
      {children}
    </WalletContext.Provider>
  );
}

export function useWallet(): WalletContextValue {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error('useWallet must be used within WalletProvider');
  return ctx;
}

export { NETWORKS, DEFAULT_NETWORK_ID };
