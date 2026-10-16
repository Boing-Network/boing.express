/**
 * React "islands" inside the vanilla popup so the extension renders the SAME components as the
 * web wallet (Validator tab with jail stats, mixed BOING/token/NFT bulk with native batch).
 */
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ValidatorPanel } from '../src/components/ValidatorPanel';
import { BulkTransferPanel } from '../src/components/BulkTransferPanel';

import { SendConfirm, type SendConfirmProps } from '../src/components/SendConfirm';
import { ReceivePanel } from '../src/components/ReceivePanel';

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
  const o = overlay();
  if (!o) return Promise.resolve(true);
  return new Promise((resolve) => {
    o.wrap.classList.remove('hidden');
    rootFor(o.el).render(
      createElement(SendConfirm, {
        ...props,
        key: `${props.to}:${props.amount}:${Date.now()}`,
        onConfirm: () => {
          closeOverlay();
          resolve(true);
        },
        onBack: () => {
          closeOverlay();
          resolve(false);
        },
      })
    );
  });
}

export function showReceiveIsland(address: string): void {
  const o = overlay();
  if (!o) return;
  o.wrap.classList.remove('hidden');
  rootFor(o.el).render(createElement(ReceivePanel, { address, onBack: closeOverlay }));
}

export function unmountIsland(el: HTMLElement): void {
  const r = roots.get(el);
  if (r) {
    r.unmount();
    roots.delete(el);
  }
}