/**
 * React "islands" inside the vanilla popup so the extension renders the SAME components as the
 * web wallet (Validator tab with jail stats, mixed BOING/token/NFT bulk with native batch).
 */
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ValidatorPanel } from '../src/components/ValidatorPanel';
import { BulkTransferPanel } from '../src/components/BulkTransferPanel';

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

export function unmountIsland(el: HTMLElement): void {
  const r = roots.get(el);
  if (r) {
    r.unmount();
    roots.delete(el);
  }
}