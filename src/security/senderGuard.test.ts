import { describe, expect, it } from 'vitest';
import { CONTENT_SCRIPT_MESSAGE_TYPES, isExtensionPageSender, originFromContentSender } from './senderGuard';

const ID = 'abcdefghijklmnopabcdefghijklmnop';
const BASE = `chrome-extension://${ID}/`;

describe('senderGuard', () => {
  it('accepts only this extension\'s own pages', () => {
    expect(isExtensionPageSender({ id: ID, url: `${BASE}popup.html?surface=window` }, ID, BASE)).toBe(true);
    expect(isExtensionPageSender({ id: ID, url: `${BASE}approval.html?requestId=1`, tab: { id: 4 } }, ID, BASE)).toBe(true);
    // Content script: same extension id, but the URL is the web page.
    expect(isExtensionPageSender({ id: ID, url: 'https://evil.example/', tab: { id: 1 } }, ID, BASE)).toBe(false);
    expect(isExtensionPageSender({ id: 'other', url: `${BASE}popup.html` }, ID, BASE)).toBe(false);
    expect(isExtensionPageSender(undefined, ID, BASE)).toBe(false);
  });

  it('derives the dApp origin from the sender, not from message fields', () => {
    expect(originFromContentSender({ origin: 'https://boing.finance', url: 'https://boing.finance/x' })).toBe('https://boing.finance');
    expect(originFromContentSender({ url: 'https://app.example:8443/path?q=1' })).toBe('https://app.example:8443');
    expect(originFromContentSender({ origin: 'null', url: 'about:blank' })).toBe('');
    expect(originFromContentSender(undefined)).toBe('');
  });

  it('lets content scripts send provider requests only', () => {
    expect([...CONTENT_SCRIPT_MESSAGE_TYPES]).toEqual(['BOING_PROVIDER_REQUEST']);
  });
});