/**
 * boing.express/connect — web signing flow for dApps without the extension (mobile, Safari, Firefox).
 * Protocol + security model: docs/WEB-SIGNING-FLOW.md. Every request needs an explicit click here;
 * keys never leave this page; results go only to the requesting origin.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import styles from './Welcome.module.css';
import { useWallet } from '../context/WalletContext';
import { accountIdToHex } from '../boing/types';
import {
  assertFromMatchesSender,
  buildTransactionApprovalDetail,
  transactionFromDappJson,
  transactionSummary,
  type TransactionApprovalDetail,
} from '../boing/dappTxRequest';
import { buildSignedTransactionHex, signingChainIdForRpc } from '../boing/signing';
import { approvalAmountContext } from '../boing/approvalAmounts';
import { buildAndSubmit } from '../boing/submitRetry';
import { signMessage } from '../crypto/keys';
import { looksLikeTransactionPreimage, messageToBytes, TX_PREIMAGE_MESSAGE_REFUSED } from '../boing/messageSigning';
import type { Transaction } from '../boing/types';
import {
  USER_REJECTED_ERROR,
  WEB_KNOWN_APPS,
  WEB_READY_TYPE,
  WEB_REQUEST_TYPE,
  WebRequestError,
  buildWebResponse,
  createConnectedSitesStore,
  createStorageReplayStore,
  parseRequestFromHash,
  redirectResponseUrl,
  respondTarget,
  validateWebRequest,
  webError,
  type WebSigningError,
  type WebSigningRequest,
  type WebSigningResponse,
} from '../boing/webSigning';

type Transport = 'popup' | 'redirect';
type Target = { id: string; origin: string; returnUrl: string; chainId: string };

function framed(): boolean {
  try {
    return window.top !== window.self;
  } catch {
    return true;
  }
}

function deliver(transport: Transport, target: Target, resp: WebSigningResponse) {
  if (transport === 'popup') {
    // Exact targetOrigin: the browser drops the message if the opener navigated elsewhere.
    window.opener?.postMessage(resp, target.origin);
    window.setTimeout(() => window.close(), 150);
  } else {
    window.location.replace(redirectResponseUrl(target.returnUrl, resp));
  }
}

export function WebSign() {
  const wallet = useWallet();
  const { isUnlocked, hasWallet, accountId, unlock, network, storedAddressHint } = wallet;
  const walletChainId = (network.config.chainId ?? '').toLowerCase();
  const isPopup = useMemo(() => new URLSearchParams(window.location.search).get('mode') === 'popup', []);
  const transport: Transport = isPopup ? 'popup' : 'redirect';

  const [rawReq, setRawReq] = useState<{ raw: unknown; eventOrigin?: string } | null>(null);
  const [req, setReq] = useState<WebSigningRequest | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [password, setPassword] = useState('');
  const [unlockError, setUnlockError] = useState('');
  const [tx, setTx] = useState<Transaction | null>(null);
  const [detail, setDetail] = useState<TransactionApprovalDetail | null>(null);
  const [summary, setSummary] = useState('');
  const [prepError, setPrepError] = useState<string | null>(null);
  const answered = useRef(false);
  const replay = useMemo(() => createStorageReplayStore(window.localStorage, () => Date.now()), []);
  const sites = useMemo(() => createConnectedSitesStore(window.localStorage), []);
  const isFramed = useMemo(framed, []);

  // 1) Receive the request (popup: postMessage from opener; redirect: URL fragment).
  useEffect(() => {
    if (isFramed) return;
    if (isPopup) {
      if (!window.opener) {
        setFatal('This page was opened without a requesting app. Start again from the app.');
        return;
      }
      const onMsg = (ev: MessageEvent) => {
        if (ev.source !== window.opener) return;
        const d = ev.data as { type?: unknown } | null;
        if (!d || d.type !== WEB_REQUEST_TYPE) return;
        window.removeEventListener('message', onMsg);
        setRawReq({ raw: ev.data, eventOrigin: ev.origin });
      };
      window.addEventListener('message', onMsg);
      // The ready ping carries no data; the opener answers with the request.
      window.opener.postMessage({ type: WEB_READY_TYPE, v: 1 }, '*');
      return () => window.removeEventListener('message', onMsg);
    }
    try {
      const raw = parseRequestFromHash(window.location.hash);
      // Drop the request from the address bar / history right away.
      window.history.replaceState(null, '', window.location.pathname);
      if (!raw) {
        setFatal('No request found. Open this page from a Boing app.');
        return;
      }
      setRawReq({ raw });
    } catch (e) {
      setFatal(e instanceof Error ? e.message : 'Invalid request.');
    }
  }, [isFramed, isPopup]);

  const respond = useCallback(
    (target: Target, outcome: { result: unknown } | { error: WebSigningError }, note: string) => {
      if (answered.current) return;
      answered.current = true;
      setDone(note);
      deliver(transport, target, buildWebResponse(target, outcome));
    },
    [transport]
  );

  // 2) Validate (origin binding, expiry, replay, chain).
  useEffect(() => {
    if (!rawReq || req || fatal) return;
    let referrerOrigin: string | null = null;
    try {
      referrerOrigin = document.referrer ? new URL(document.referrer).origin : null;
    } catch {
      referrerOrigin = null;
    }
    try {
      const v = validateWebRequest(rawReq.raw, {
        now: Date.now(),
        transport,
        eventOrigin: rawReq.eventOrigin,
        referrerOrigin,
        walletChainId,
        seen: replay,
      });
      replay.add(v.id, v.expiresAt); // single use from here on
      setReq(v);
    } catch (e) {
      const err = e instanceof WebRequestError ? e : new WebRequestError('BOING_WEB_BAD_REQUEST', 'Invalid request.');
      const target = err.respondable ? respondTarget(rawReq.raw) : null;
      if (target && (transport === 'redirect' || rawReq.eventOrigin === target.origin)) {
        if (err.boingCode !== 'BOING_WEB_REPLAY') {
          respond(target, { error: webError(err.boingCode, err.message, err.code) }, err.message);
          return;
        }
      }
      setFatal(err.message);
    }
  }, [rawReq, req, fatal, transport, walletChainId, replay, respond]);

  const senderHex = accountId ? `0x${accountIdToHex(accountId)}` : null;
  const connected = req && senderHex ? sites.get(req.origin) : null;
  const needsConnection =
    !!req && req.method !== 'boing_requestAccounts' && (!connected || connected.account !== senderHex);

  // 3) Prepare transaction details for review (nonce lookup, decoding, self-transfer guard).
  useEffect(() => {
    if (!req || !isUnlocked || !accountId || !senderHex) return;
    if (req.method !== 'boing_signTransaction' && req.method !== 'boing_sendTransaction') return;
    if (needsConnection) return;
    let cancelled = false;
    (async () => {
      try {
        const txReq = req.params[0];
        if (!txReq || typeof txReq !== 'object') throw new Error('Pass one transaction object.');
        assertFromMatchesSender(txReq, senderHex.replace(/^0x/, ''));
        const o = txReq as Record<string, unknown>;
        const explicit = o.nonce !== undefined && o.nonce !== null && String(o.nonce).trim() !== '';
        const nonce = explicit ? 0n : await network.getNonce(accountId);
        const t = transactionFromDappJson(txReq, accountId, nonce);
        if (cancelled) return;
        const amountCtx = await approvalAmountContext(network.config.rpcUrl, t, wallet.privateKey);
        if (cancelled) return;
        setTx(t);
        setSummary(transactionSummary(t, amountCtx));
        setDetail(buildTransactionApprovalDetail(t, amountCtx));
      } catch (e) {
        if (!cancelled) setPrepError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [req, isUnlocked, accountId, senderHex, network, needsConnection, wallet.privateKey]);

  const messageInfo = useMemo(() => {
    if (!req || req.method !== 'boing_signMessage') return null;
    try {
      const m = req.params[0];
      const bytes = messageToBytes(m);
      const refused = accountId ? looksLikeTransactionPreimage(bytes, accountId) : false;
      return { text: String(m), bytes, refused, error: null as string | null };
    } catch (e) {
      return { text: '', bytes: new Uint8Array(), refused: false, error: e instanceof Error ? e.message : String(e) };
    }
  }, [req, accountId]);

  const reject = useCallback(() => {
    if (req) respond(req, { error: USER_REJECTED_ERROR }, 'Request rejected.');
  }, [req, respond]);

  const refuse = useCallback(
    (code: string, message: string) => {
      if (req) respond(req, { error: webError(code, message) }, message);
    },
    [req, respond]
  );

  const approve = useCallback(async () => {
    if (!req || !accountId || !senderHex || !wallet.privateKey) return;
    if (Date.now() > req.expiresAt) {
      refuse('BOING_WEB_EXPIRED', 'Request expired. Start again from the app.');
      return;
    }
    setBusy(true);
    try {
      if (req.method === 'boing_requestAccounts') {
        sites.set(req.origin, { account: senderHex, chainId: req.chainId, connectedAt: Date.now() });
        respond(req, { result: [senderHex] }, 'Connected. You can return to the app.');
        return;
      }
      if (req.method === 'boing_signMessage') {
        if (!messageInfo || messageInfo.error) throw new Error(messageInfo?.error ?? 'Invalid message.');
        if (messageInfo.refused) throw new Error(TX_PREIMAGE_MESSAGE_REFUSED);
        const sig = await signMessage(messageInfo.bytes, wallet.privateKey);
        respond(req, { result: sig }, 'Message signed. You can return to the app.');
        return;
      }
      if (!tx) throw new Error(prepError ?? 'Transaction not ready.');
      const chainId = await signingChainIdForRpc(network.config.rpcUrl);
      const signingKey = wallet.privateKey;
      const signWith = async (t: Transaction) => {
        const signed = await buildSignedTransactionHex(t, signingKey, chainId);
        return signed.startsWith('0x') ? signed : `0x${signed}`;
      };
      const hex = await signWith(tx);
      if (req.method === 'boing_signTransaction') {
        respond(req, { result: hex }, 'Transaction signed. You can return to the app.');
        return;
      }
      const requested = req.params[0] as Record<string, unknown> | undefined;
      const explicitNonce = requested?.nonce !== undefined && requested?.nonce !== null && String(requested.nonce).trim() !== '';
      // The approval can sit open for a while: for a wallet-chosen nonce, sign with the account's current
      // nonce at send time, and re-sign once if the node says `stale_nonce`. A dApp-pinned nonce is sent as-is.
      const sent = explicitNonce
        ? await network.submitTransaction(hex)
        : await buildAndSubmit(network, accountId, (nonce) => signWith({ ...tx, nonce }));
      if (!sent.success) {
        respond(req, { error: webError('BOING_SUBMIT_FAILED', sent.error ?? 'Submit failed.', -32603, sent.reason) }, sent.error ?? 'Submit failed.');
        return;
      }
      respond(req, { result: sent.txHash ?? sent.txId }, 'Transaction sent. You can return to the app.');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      respond(req, { error: webError('BOING_SIGN_FAILED', msg) }, msg);
    } finally {
      setBusy(false);
    }
  }, [req, accountId, senderHex, wallet.privateKey, sites, respond, messageInfo, tx, prepError, network, refuse]);

  const onUnlock = async (e: React.FormEvent) => {
    e.preventDefault();
    setUnlockError('');
    setBusy(true);
    try {
      await unlock(password);
      setPassword('');
    } catch {
      setUnlockError('Wrong password.');
    } finally {
      setBusy(false);
    }
  };

  const shell = (body: React.ReactNode) => (
    <div className={`${styles.wrap} page-app`} data-testid="web-sign">
      <div className={styles.card}>{body}</div>
    </div>
  );

  if (isFramed) return shell(<p className={styles.error}>Boing Express can't be shown inside another page.</p>);
  if (done) return shell(<><h1 className={styles.title}>Done</h1><p className={styles.subtitle} data-testid="web-sign-done">{done}</p></>);
  if (fatal) return shell(<><h1 className={styles.title}>Can't continue</h1><p className={styles.error} data-testid="web-sign-fatal">{fatal}</p></>);
  if (!req) return shell(<p className={styles.subtitle}>Waiting for the app's request…</p>);

  const appName = WEB_KNOWN_APPS[req.origin];
  const originBlock = (
    <div className={styles.hint} data-testid="web-sign-origin">
      <strong>{req.origin}</strong>
      <br />
      {appName ? `Boing app: ${appName}` : 'Not a registered Boing app. Check this address before you continue.'}
      {transport === 'redirect' ? <><br />The result is returned only to this address.</> : null}
    </div>
  );

  if (!hasWallet) {
    return shell(
      <>
        <h1 className={styles.title}>No wallet yet</h1>
        {originBlock}
        <p className={styles.subtitle}>Create or import a wallet on boing.express first, then retry from the app.</p>
        <Link to="/wallet" className={styles.primary}>Open wallet</Link>
        <button type="button" className={styles.textBtn} onClick={reject}>Cancel</button>
      </>
    );
  }

  if (!isUnlocked) {
    return shell(
      <>
        <h1 className={styles.title}>Unlock to continue</h1>
        {originBlock}
        {storedAddressHint ? <p className={styles.hint}>Address: {storedAddressHint}</p> : null}
        <form onSubmit={onUnlock} className={styles.form}>
          <input type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} className={styles.input} autoComplete="current-password" data-testid="web-sign-password" />
          {unlockError ? <p className={styles.error}>{unlockError}</p> : null}
          <button type="submit" className={styles.primary} disabled={busy} data-testid="web-sign-unlock">Unlock</button>
        </form>
        <button type="button" className={styles.textBtn} onClick={reject} data-testid="web-sign-reject">Cancel</button>
      </>
    );
  }

  if (needsConnection) {
    return shell(
      <>
        <h1 className={styles.title}>Not connected</h1>
        {originBlock}
        <p className={styles.error} data-testid="web-sign-not-connected">This site isn't connected to the active account. Connect from the app first.</p>
        <button type="button" className={styles.secondary} onClick={() => refuse('BOING_ORIGIN_NOT_CONNECTED', 'Origin is not connected. Call boing_requestAccounts first.')}>Close</button>
      </>
    );
  }

  const chainRow = <p className={styles.hint}>Network: {network.config.name} ({req.chainId}) · Account: {senderHex?.slice(0, 10)}…{senderHex?.slice(-6)}</p>;
  const buttons = (canApprove: boolean, label: string) => (
    <div className={styles.actions}>
      <button type="button" className={styles.secondary} onClick={reject} disabled={busy} data-testid="web-sign-reject">Reject</button>
      <button type="button" className={styles.primary} onClick={approve} disabled={busy || !canApprove} data-testid="web-sign-approve">{label}</button>
    </div>
  );

  if (req.method === 'boing_requestAccounts') {
    return shell(
      <>
        <h1 className={styles.title}>Connect to this site?</h1>
        {originBlock}
        {chainRow}
        <p className={styles.subtitle}>The site will see your address. It can't move funds; every signature needs a separate approval here.</p>
        {buttons(true, 'Connect')}
      </>
    );
  }

  if (req.method === 'boing_signMessage') {
    return shell(
      <>
        <h1 className={styles.title}>Sign message</h1>
        {originBlock}
        {chainRow}
        <pre className={styles.textarea} style={{ whiteSpace: 'pre-wrap', maxHeight: 200, overflow: 'auto' }} data-testid="web-sign-message">{messageInfo?.text}</pre>
        {messageInfo?.error ? <p className={styles.error}>{messageInfo.error}</p> : null}
        {messageInfo?.refused ? <p className={styles.error} data-testid="web-sign-refused">{TX_PREIMAGE_MESSAGE_REFUSED}</p> : null}
        {buttons(!!messageInfo && !messageInfo.error && !messageInfo.refused, 'Sign')}
      </>
    );
  }

  const isSend = req.method === 'boing_sendTransaction';
  return shell(
    <>
      <h1 className={styles.title}>{isSend ? 'Sign and send transaction' : 'Sign transaction'}</h1>
      {originBlock}
      {chainRow}
      {prepError ? <p className={styles.error} data-testid="web-sign-prep-error">{prepError}</p> : null}
      {!prepError && !detail ? <p className={styles.subtitle}>Preparing…</p> : null}
      {detail ? (
        <div data-testid="web-sign-tx">
          <p className={styles.subtitle}>{summary}</p>
          <dl style={{ textAlign: 'left', fontSize: 13 }}>
            {detail.rows.map((r) => (
              <div key={r.label} style={{ marginBottom: 6 }}>
                <dt style={{ opacity: 0.7 }}>{r.label}</dt>
                <dd style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{r.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      ) : null}
      {prepError ? (
        <div className={styles.actions}>
          <button type="button" className={styles.secondary} onClick={() => refuse('BOING_INVALID_TX', prepError)} data-testid="web-sign-close">Close</button>
        </div>
      ) : (
        buttons(!!tx, isSend ? 'Sign and send' : 'Sign')
      )}
    </>
  );
}
