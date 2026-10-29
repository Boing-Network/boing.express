import { describe, expect, it } from 'vitest';
import {
  dappDisplayHintFromJson,
  describeCalldataIntent,
} from './calldataIntent';
import { buildTransactionApprovalDetail, transactionSummary } from './dappTxRequest';
import type { AccountId, Transaction } from './types';
import { emptyAccessList } from './accessList';

const S = new Uint8Array(32).fill(0x11) as AccountId;
const SPENDER = new Uint8Array(32).fill(0x22) as AccountId;

function wordSel(sel: number): Uint8Array {
  const w = new Uint8Array(32);
  w[31] = sel;
  return w;
}
function wordAccount(a: AccountId): Uint8Array {
  return new Uint8Array(a);
}
function wordU128(v: bigint): Uint8Array {
  const w = new Uint8Array(32);
  let x = v;
  for (let i = 31; i >= 16; i--) {
    w[i] = Number(x & 0xffn);
    x >>= 8n;
  }
  return w;
}
function concat(...parts: Uint8Array[]): Uint8Array {
  const n = parts.reduce((a, p) => a + p.length, 0);
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

const tx = (payload: Transaction['payload']): Transaction => ({
  nonce: 1n,
  sender: S,
  payload,
  access_list: emptyAccessList(),
});

describe('dappDisplayHintFromJson', () => {
  it('reads display then description', () => {
    expect(dappDisplayHintFromJson({ display: '  Approve 10 BOING  ' })).toBe('Approve 10 BOING');
    expect(dappDisplayHintFromJson({ description: 'Swap 1 → 2' })).toBe('Swap 1 → 2');
    expect(dappDisplayHintFromJson({ display: 'a', description: 'b' })).toBe('a');
    expect(dappDisplayHintFromJson({})).toBeUndefined();
  });
});

describe('describeCalldataIntent', () => {
  it('decodes reference approve', () => {
    const cd = concat(wordSel(0x08), wordAccount(SPENDER), wordU128(100n));
    const i = describeCalldataIntent(cd)!;
    expect(i.action).toBe('Approve');
    expect(i.summary).toContain('Approve 100 tokens');
    expect(i.summary).toContain('0x2222');
  });

  it('decodes reference transfer (Send)', () => {
    const cd = concat(wordSel(0x01), wordAccount(SPENDER), wordU128(20n));
    expect(describeCalldataIntent(cd)!.summary).toContain('Send 20 tokens');
  });

  it('decodes native AMM swap', () => {
    const cd = concat(wordSel(0x10), wordU128(0n), wordU128(50n), wordU128(45n));
    const i = describeCalldataIntent(cd)!;
    expect(i.action).toBe('Swap');
    expect(i.summary).toMatch(/Swap 50/);
    expect(i.summary).toMatch(/min out 45/);
  });

  it('decodes custody router swap', () => {
    const pool = new Uint8Array(32).fill(0x33) as AccountId;
    const tokenIn = new Uint8Array(32).fill(0x44) as AccountId;
    const recipient = new Uint8Array(32).fill(0x55) as AccountId;
    const cd = concat(
      wordSel(0xf1),
      wordU128(1n),
      wordU128(10n),
      wordU128(9n),
      wordAccount(recipient),
      wordU128(0n),
      wordAccount(pool),
      wordU128(0n),
      wordAccount(tokenIn)
    );
    const i = describeCalldataIntent(cd)!;
    expect(i.summary).toMatch(/Swap 10 via router/);
    expect(i.summary).toMatch(/min out 9/);
  });
});

describe('approval detail with display + decode', () => {
  it('shows Intent from dApp display and decoded Operation for approve', () => {
    const cd = concat(wordSel(0x08), wordAccount(SPENDER), wordU128(7n));
    const t = tx({ kind: 'contract_call', contract: SPENDER, calldata: cd });
    const d = buildTransactionApprovalDetail(t, { decimals: 18 }, { display: 'Approve 7 YOLO to be swapped' });
    expect(d.rows.find((r) => r.label === 'Intent')?.value).toBe('Approve 7 YOLO to be swapped');
    expect(d.rows.find((r) => r.label === 'Operation')?.value).toContain('Approve 7 tokens');
    expect(d.summaryLine).toContain('Approve 7 YOLO to be swapped');
    expect(transactionSummary(t, { decimals: 18 }, { display: 'Approve 7 YOLO to be swapped' })).toContain(
      'Approve 7 YOLO to be swapped'
    );
  });

  it('decodes swap without display', () => {
    const cd = concat(wordSel(0x10), wordU128(1n), wordU128(3n), wordU128(2n));
    const t = tx({ kind: 'contract_call', contract: SPENDER, calldata: cd });
    const d = buildTransactionApprovalDetail(t);
    expect(d.rows.find((r) => r.label === 'Operation')?.value).toMatch(/Swap 3/);
    expect(d.summaryLine).toMatch(/Swap 3/);
  });
});
