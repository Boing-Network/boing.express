/**
 * Runtime-message sender validation for the extension service worker.
 *
 * Content scripts run inside web pages, so only `BOING_PROVIDER_REQUEST` may arrive from them, and the dApp
 * origin must come from the browser-supplied `sender` (never from a field the page-controlled script wrote).
 * Everything else (unlock/lock, session restore, approval resolution) is for extension pages only.
 */

export type MessageSenderLike = {
  id?: string;
  url?: string;
  origin?: string;
  tab?: unknown;
};

/** True when the message came from one of this extension's own pages (popup, approval, unlock window). */
export function isExtensionPageSender(sender: MessageSenderLike | undefined, extensionId: string, extensionBaseUrl: string): boolean {
  if (!sender || sender.id !== extensionId) return false;
  const url = sender.url ?? '';
  return url.startsWith(extensionBaseUrl);
}

/** Origin of the page behind a content-script message, from the browser-provided sender. Empty string if unknown. */
export function originFromContentSender(sender: MessageSenderLike | undefined): string {
  if (!sender) return '';
  if (typeof sender.origin === 'string' && sender.origin && sender.origin !== 'null') return sender.origin;
  if (typeof sender.url === 'string') {
    try {
      const u = new URL(sender.url);
      if (u.origin && u.origin !== 'null') return u.origin;
    } catch {
      /* fall through */
    }
  }
  return '';
}

/** Message types a content script (web page context) is allowed to send. */
export const CONTENT_SCRIPT_MESSAGE_TYPES: ReadonlySet<string> = new Set(['BOING_PROVIDER_REQUEST']);