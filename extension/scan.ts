/**
 * Extension QR scanner page. The popup cannot reliably show a camera permission prompt (it closes when it loses
 * focus), so "Scan QR" opens this extension page in a tab. The camera permission is asked for the extension's own
 * origin at runtime (no manifest permission needed). The decoded address is handed back through
 * chrome.storage.local (`boing_scan_result`); the popup fills the recipient field the next time it opens.
 */
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { QrScanner } from '../src/components/QrScanner';

export const SCAN_RESULT_KEY = 'boing_scan_result';
const ALLOWED_FIELDS = new Set(['send-to', 'token-send-to', 'nft-transfer-to']);

const params = new URLSearchParams(location.search);
const field = ALLOWED_FIELDS.has(params.get('field') ?? '') ? (params.get('field') as string) : 'send-to';
const el = document.getElementById('scan-root');

if (el) {
  const root = createRoot(el);
  root.render(
    createElement(QrScanner, {
      standalone: true,
      onClose: () => window.close(),
      onResult: (address: string) => {
        chrome.storage.local.set({ [SCAN_RESULT_KEY]: { field, value: address, ts: Date.now() } }, () => {
          root.unmount();
          el.innerHTML = '';
          const p = document.createElement('div');
          p.className = 'done';
          p.setAttribute('data-testid', 'qr-scan-done');
          p.textContent = `Scanned ${address.slice(0, 10)}…${address.slice(-6)}. Open Boing Express again: the recipient is filled in. This tab closes now.`;
          el.appendChild(p);
          window.setTimeout(() => window.close(), 2500);
        });
      },
    })
  );
}
