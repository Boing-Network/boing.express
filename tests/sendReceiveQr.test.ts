import { describe, expect, it } from 'vitest';
import jsQR from 'jsqr';
import qrcode from 'qrcode-generator';
import { parseScannedAddress, qrSvgPath, shortAddress } from '../src/boing/qr';
import { estimateSendFee, feeLabel } from '../src/boing/feeEstimate';
import { contractTokenName, contractTokenSymbol, defaultTokensForChainId, TEST_BOING_TOKEN_SYMBOL } from '../src/boing/defaultTokens';
import type { NetworkAdapter } from '../src/networks/types';

const ADDR = '0x' + 'ab'.repeat(32);

describe('QR', () => {
  it('parses addresses from raw hex, 0x, boing: URIs and links; rejects junk', () => {
    expect(parseScannedAddress('ab'.repeat(32))).toBe(ADDR);
    expect(parseScannedAddress(ADDR.toUpperCase().replace('0X', '0x'))).toBe(ADDR);
    expect(parseScannedAddress(`boing:${ADDR}?amount=5`)).toBe(ADDR);
    expect(parseScannedAddress(`https://boing.observer/account/${ADDR}`)).toBe(ADDR);
    expect(parseScannedAddress('hello')).toBeNull();
    expect(parseScannedAddress('ab'.repeat(33))).toBeNull();
  });

  it('encodes the address so a decoder reads it back', () => {
    const { d, size } = qrSvgPath(ADDR);
    expect(size).toBeGreaterThanOrEqual(21);
    expect(d.length).toBeGreaterThan(100);
    // Round-trip through a real decoder using the same matrix.
    const qr = qrcode(0, 'M');
    qr.addData(ADDR);
    qr.make();
    const scale = 4;
    const pad = 4;
    const n = qr.getModuleCount();
    const w = (n + pad * 2) * scale;
    const px = new Uint8ClampedArray(w * w * 4).fill(255);
    for (let r = 0; r < n; r++)
      for (let c = 0; c < n; c++)
        if (qr.isDark(r, c))
          for (let y = 0; y < scale; y++)
            for (let x = 0; x < scale; x++) {
              const i = (((r + pad) * scale + y) * w + (c + pad) * scale + x) * 4;
              px[i] = px[i + 1] = px[i + 2] = 0;
            }
    expect(jsQR(px, w, w)?.data).toBe(ADDR);
    expect(shortAddress(ADDR, 6, 4)).toBe('0xababab…abab');
  });
});

describe('send fee estimate', () => {
  const base = { getNonce: async () => 0n } as unknown as NetworkAdapter;
  it('uses simulated gas (21 000 gas = 1 BOING), times tx count', async () => {
    const net = { ...base, simulateGas: async () => ({ success: true, gasUsed: 45_000n }) } as NetworkAdapter;
    const e = await estimateSendFee(net, async () => '00', 2);
    expect(e).toEqual({ state: 'ok', fee: 6n, exact: true });
    expect(feeLabel(e)).toBe('6 BOING');
  });
  it('falls back to ~1 BOING when the node reports no gas; reports a failing simulation', async () => {
    const noGas = { ...base, simulateGas: async () => ({ success: true }) } as NetworkAdapter;
    expect(feeLabel(await estimateSendFee(noGas, async () => '00'))).toBe('≈ 1 BOING');
    const failing = { ...base, simulateGas: async () => ({ success: false, error: 'insufficient balance' }) } as NetworkAdapter;
    expect(await estimateSendFee(failing, async () => '00')).toEqual({ state: 'fail', error: 'insufficient balance' });
  });
});

describe('contract token labels', () => {
  it('the testnet BOING reference token is tBOING / Boing Token (test), never plain BOING', () => {
    const d = defaultTokensForChainId('0x1b01');
    const t = d.find((x) => x.symbol !== 'USDC')!;
    expect(t.symbol).toBe(TEST_BOING_TOKEN_SYMBOL);
    expect(contractTokenName(t.tokenHex)).toBe('Boing Token (test)');
    expect(contractTokenSymbol('BOING')).toBe('tBOING');
    expect(contractTokenSymbol('boing')).toBe('tBOING');
    expect(contractTokenSymbol('USDC')).toBe('USDC');
  });
});
