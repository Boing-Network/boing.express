import { describe, expect, it } from 'vitest';
import {
  mapInjectedProviderErrorToUiMessage,
  connectInjectedBoingWallet,
  type Eip1193Requester,
} from '../src/boing/injectedWallet';

describe('injectedWallet', () => {
  it('maps Boing Express boingCode', () => {
    expect(
      mapInjectedProviderErrorToUiMessage({
        code: 4100,
        message: 'x',
        data: { boingCode: 'BOING_ORIGIN_NOT_CONNECTED' },
      })
    ).toMatch(/Connect this site first/);
  });

  it('maps BOING_NODE_JSONRPC via rpc code', () => {
    const s = mapInjectedProviderErrorToUiMessage({
      code: -32050,
      message: 'fail',
      data: { boingCode: 'BOING_NODE_JSONRPC', rpc: { code: -32050, message: 'QA rejected' } },
    });
    expect(s).toMatch(/QA|rejected|protocol/i);
  });

  it('extends simulation failure with access list hint', () => {
    const s = mapInjectedProviderErrorToUiMessage({
      code: -32603,
      message: 'sim',
      data: {
        boingCode: 'BOING_SIMULATION_FAILED',
        suggested_access_list: { read: ['0x' + 'aa'.repeat(32)], write: [] },
        access_list_covers_suggestion: false,
      },
    });
    expect(s).toMatch(/access_list|network suggested/i);
  });

  it('matches SDK-style user reject', () => {
    expect(mapInjectedProviderErrorToUiMessage({ code: 4001, message: 'User rejected' })).toMatch(/cancelled/);
  });

  it('connectInjectedBoingWallet aggregates parallel calls', async () => {
    const provider: Eip1193Requester = {
      request: async ({ method }) => {
        if (method === 'boing_requestAccounts') return ['0x' + '11'.repeat(32)];
        if (method === 'boing_chainId') return '0x1b01';
        if (method === 'eth_chainId') return '0x1b01';
        throw new Error('unexpected');
      },
    };
    const r = await connectInjectedBoingWallet(provider);
    expect(r.accounts).toHaveLength(1);
    expect(r.chainIdHex).toBe('0x1b01');
    expect(r.supportsBoingNativeRpc).toBe(true);
  });
});
