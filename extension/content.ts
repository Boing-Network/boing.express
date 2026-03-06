/**
 * Boing Express content script.
 * - Injects inpage.js into the page so window.boing (EIP-1193 provider) is available to dApps.
 * - Bridges provider requests from the page to the background service worker and back.
 */

const BOING_PROVIDER_SOURCE = 'boing-inpage';
const BOING_CONTENT_SOURCE = 'boing-content';

function injectInpageScript(): void {
  try {
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('inpage.js');
    script.type = 'text/javascript';
    script.onload = () => script.remove();
    (document.head ?? document.documentElement).appendChild(script);
  } catch (_) {
    // Ignore in restricted environments
  }
}

injectInpageScript();

window.addEventListener('message', (event: MessageEvent) => {
  if (event.source !== window || !event.data || event.data.source !== BOING_PROVIDER_SOURCE) return;
  const { type, id, method, params } = event.data;
  if (type !== 'request' || id == null || method == null) return;

  const origin = window.location.origin;

  chrome.runtime.sendMessage(
    {
      type: 'BOING_PROVIDER_REQUEST',
      id,
      method,
      params: params ?? [],
      origin,
    },
    (response: unknown) => {
      const data = response as { type?: string; id?: number | string; result?: unknown; error?: string } | undefined;
      if (!data || data.type !== 'BOING_PROVIDER_RESPONSE') {
        window.postMessage(
          {
            source: BOING_CONTENT_SOURCE,
            type: 'response',
            id,
            error: 'Boing Express: no response from extension',
          },
          '*'
        );
        return;
      }
      window.postMessage(
        {
          source: BOING_CONTENT_SOURCE,
          type: 'response',
          id: data.id,
          result: data.result,
          error: data.error,
        },
        '*'
      );
    }
  );
});
