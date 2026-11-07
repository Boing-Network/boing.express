/**
 * In-extension NFT detail sheet: transfer, explorer link, and optional watchlist remove.
 * Sized for the Express popup; Esc / backdrop dismiss; simple Tab cycle within the dialog.
 */

import { useEffect, useId, useRef } from 'react';
import type { NftHoldingStatus } from '../boing/nftHoldings';
import type { NftDisplayMeta } from '../boing/nftMetadata';
import { ScanQrButton } from './ScanQrButton';
import { SendConfirm } from './SendConfirm';
import styles from '../screens/Dashboard.module.css';

export type NftDetailModalProps = {
  item: NftHoldingStatus;
  meta: NftDisplayMeta | undefined;
  itemUrl: string;
  title: string;
  onClose: () => void;
  /** Local watchlist unlist — secondary; omit when not applicable. */
  onRemove?: () => void;
  /** Owned items show the transfer form. */
  canTransfer: boolean;
  transferTo: string;
  onTransferToChange: (value: string) => void;
  onTransferSubmit: (e: React.FormEvent) => void;
  transferring: boolean;
  transferError: string;
  transferSuccess: string;
  transferProgress: string | null;
  confirmBatch: boolean;
  /** When confirming, parent renders SendConfirm via these props. */
  sendConfirm?: {
    to: string;
    toName?: string;
    amount: string;
    network: React.ComponentProps<typeof SendConfirm>['network'];
    buildSigned: React.ComponentProps<typeof SendConfirm>['buildSigned'];
    onBack: () => void;
    onConfirm: () => void;
  } | null;
};

export function NftDetailModal({
  item,
  meta,
  itemUrl,
  title,
  onClose,
  onRemove,
  canTransfer,
  transferTo,
  onTransferToChange,
  onTransferSubmit,
  transferring,
  transferError,
  transferSuccess,
  transferProgress,
  confirmBatch,
  sendConfirm,
}: NftDetailModalProps) {
  const titleId = useId();
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== 'Tab' || !dialogRef.current) return;
      const nodes = dialogRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      const list = [...nodes].filter((el) => el.offsetParent !== null || el === document.activeElement);
      if (list.length === 0) return;
      const first = list[0]!;
      const last = list[list.length - 1]!;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      prev?.focus?.();
    };
  }, [onClose]);

  return (
    <div
      className={styles.nftModalBackdrop}
      onClick={onClose}
      data-testid="nft-detail-backdrop"
    >
      <section
        ref={dialogRef}
        className={styles.nftModalCard}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-testid="nft-detail-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          ref={closeRef}
          type="button"
          className={styles.nftModalClose}
          onClick={onClose}
          aria-label="Close"
          data-testid="nft-detail-close"
        >
          ×
        </button>

        <div className={styles.nftModalMedia}>
          {meta?.imageUrl ? (
            <img
              src={meta.imageUrl}
              alt=""
              className={styles.nftModalThumb}
              onError={(ev) => {
                (ev.currentTarget as HTMLImageElement).style.display = 'none';
                const ph = ev.currentTarget.nextElementSibling;
                if (ph instanceof HTMLElement) ph.hidden = false;
              }}
            />
          ) : null}
          <span
            className={styles.nftModalThumbPlaceholder}
            hidden={Boolean(meta?.imageUrl)}
            aria-hidden
          />
        </div>

        <h2 id={titleId} className={styles.nftModalTitle}>
          {title}
        </h2>
        {meta?.description ? (
          <p className={styles.nftModalDescription}>{meta.description}</p>
        ) : null}
        {item.error ? <p className={styles.error}>{item.error}</p> : null}

        <a
          href={itemUrl}
          target="_blank"
          rel="noopener noreferrer"
          className={styles.nftModalExplorer}
          data-testid="nft-detail-explorer"
        >
          View on block explorer ↗
        </a>

        {canTransfer && sendConfirm && confirmBatch ? (
          <SendConfirm
            title="Send NFT"
            to={sendConfirm.to}
            toName={sendConfirm.toName}
            amount={sendConfirm.amount}
            network={sendConfirm.network}
            txCount={1}
            buildSigned={sendConfirm.buildSigned}
            showPriorityTip={false}
            busy={transferring}
            error={transferError}
            onBack={sendConfirm.onBack}
            onConfirm={sendConfirm.onConfirm}
          />
        ) : null}

        {canTransfer && !(sendConfirm && confirmBatch) ? (
          <form
            onSubmit={onTransferSubmit}
            className={styles.form}
            data-testid="nft-detail-transfer-form"
          >
            <div className={styles.inlineRow}>
              <input
                type="text"
                placeholder="To address or name.boing"
                value={transferTo}
                onChange={(e) => onTransferToChange(e.target.value)}
                className={styles.input}
                aria-label="NFT transfer recipient"
                data-testid="nft-detail-transfer-to"
              />
              <ScanQrButton
                className={styles.copyBtn}
                testId="nft-detail-transfer-to-scan"
                onResult={onTransferToChange}
              />
            </div>
            {transferProgress && <p className={styles.addressHint}>{transferProgress}</p>}
            {transferError && <p className={styles.error}>{transferError}</p>}
            {transferSuccess && <p className={styles.success}>{transferSuccess}</p>}
            <button
              type="submit"
              className={styles.primary}
              disabled={transferring}
              data-testid="nft-detail-transfer-submit"
            >
              {transferring ? 'Transferring…' : confirmBatch ? 'Confirm transfer' : 'Transfer'}
            </button>
          </form>
        ) : null}

        {!canTransfer && !item.owned ? (
          <p className={styles.addressHint}>
            {item.exists ? 'Not currently owned by this wallet.' : 'Not found on chain.'}
          </p>
        ) : null}

        {onRemove ? (
          <button
            type="button"
            className={styles.nftModalRemove}
            onClick={onRemove}
            data-testid="nft-detail-remove"
          >
            Remove from wallet view
          </button>
        ) : null}
      </section>
    </div>
  );
}
