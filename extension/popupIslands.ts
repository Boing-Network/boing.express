/**
 * React "islands" inside the vanilla popup so the extension renders the SAME components as the
 * web wallet (Validator tab with jail stats, mixed BOING/token/NFT bulk with native batch).
 */
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ValidatorPanel } from '../src/components/ValidatorPanel';
import { BulkTransferPanel } from '../src/components/BulkTransferPanel';

import { SendConfirm, type SendConfirmProps } from '../src/components/SendConfirm';
import { AddressQrModal } from '../src/components/AddressQrModal';
import { NamesPanel, type NamesPanelProps } from '../src/components/NamesPanel';
import { PendingNameBanner } from '../src/components/PendingNameBanner';
import { ClaimNameStep, type ClaimNameStepProps } from '../src/components/ClaimNameStep';

type PendingProps = Parameters<typeof PendingNameBanner>[0];

/** Settings → Names (same component as the web wallet). */
export function renderNamesIsland(el: HTMLElement, props: NamesPanelProps, key: string): void {
  rootFor(el).render(createElement(NamesPanel, { ...props, key }));
}

/** Wallet tab banner that finishes the name picked at creation once the account is funded. */
export function renderPendingNameIsland(el: HTMLElement, props: PendingProps, key: string): void {
  rootFor(el).render(createElement(PendingNameBanner, { ...props, key }));
}

/** Optional pick-a-name step after creating a wallet. */
export function renderClaimNameIsland(el: HTMLElement, props: ClaimNameStepProps): void {
  rootFor(el).render(createElement(ClaimNameStep, props));
}

type ValidatorProps = Parameters<typeof ValidatorPanel>[0];
type BulkProps = Parameters<typeof BulkTransferPanel>[0];

const roots = new Map<HTMLElement, Root>();

function rootFor(el: HTMLElement): Root {
  let r = roots.get(el);
  if (!r) {
    r = createRoot(el);
    roots.set(el, r);
  }
  return r;
}

/** `key` forces a fresh component when the account / network changes. */
export function renderValidatorIsland(el: HTMLElement, props: ValidatorProps, key: string): void {
  rootFor(el).render(createElement(ValidatorPanel, { ...props, key }));
}

export function renderBulkIsland(el: HTMLElement, props: BulkProps, key: string): void {
  rootFor(el).render(createElement(BulkTransferPanel, { ...props, key }));
}

function overlay(): { wrap: HTMLElement; el: HTMLElement } | null {
  const wrap = document.getElementById('overlay-root');
  const el = document.getElementById('overlay-island');
  return wrap && el ? { wrap, el } : null;
}

function closeOverlay(): void {
  const o = overlay();
  if (!o) return;
  unmountIsland(o.el);
  o.wrap.classList.add('hidden');
}

/**
 * Review step before a send (same component as the web wallet): resolves true on CONFIRM SEND, false on back.
 * The card closes on confirm; the caller submits and reports the result in its own form.
 */
export function confirmSendIsland(props: Omit<SendConfirmProps, 'onConfirm' | 'onBack'>): Promise<boolean> {
  return confirmSendTipIsland(props).then((tip) => tip !== null);
}

/** Same review step, but resolves with the priority tip the user chose (base units, 0n = none), or null on back. */
export function confirmSendTipIsland(props: Omit<SendConfirmProps, 'onConfirm' | 'onBack'>): Promise<bigint | null> {
  const o = overlay();
  if (!o) return Promise.resolve(0n);
  return new Promise((resolve) => {
    o.wrap.classList.remove('hidden');
    rootFor(o.el).render(
      createElement(SendConfirm, {
        ...props,
        key: `${props.to}:${props.amount}:${Date.now()}`,
        onConfirm: (priorityTip: bigint) => {
          closeOverlay();
          resolve(priorityTip);
        },
        onBack: () => {
          closeOverlay();
          resolve(null);
        },
      })
    );
  });
}

export function showAddressQrIsland(address: string): void {
  const o = overlay();
  if (!o) return;
  o.wrap.classList.remove('hidden');
  rootFor(o.el).render(createElement(AddressQrModal, { address, onClose: closeOverlay, logoSrc: 'images/qr-mascot.webp', inline: true }));
}

export function unmountIsland(el: HTMLElement): void {
  const r = roots.get(el);
  if (r) {
    r.unmount();
    roots.delete(el);
  }
}