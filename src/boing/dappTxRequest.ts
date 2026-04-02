/**
 * Parse dApp JSON transaction requests (boing_signTransaction / boing_sendTransaction).
 */

import type { AccountId, AccessList, Payload, Transaction } from './types';
import { accountIdFromHex, accountIdToHex, formatAddress } from './types';

const U128_MAX = (1n << 128n) - 1n;

/** Must match boing_qa::VALID_PURPOSE_CATEGORIES (case-insensitive). */
const QA_PURPOSE_ALLOWED = new Set([
  'dapp',
  'token',
  'nft',
  'meme',
  'community',
  'entertainment',
  'tooling',
  'other',
]);

export function assertValidQaPurposeCategory(purpose: string): void {
  const k = purpose.trim().toLowerCase();
  if (!QA_PURPOSE_ALLOWED.has(k)) {
    throw new Error(
      `Invalid purpose_category for Boing protocol QA. Use one of: ${[...QA_PURPOSE_ALLOWED].join(', ')}`
    );
  }
}

function emptyAccessList(): AccessList {
  return { read: [], write: [] };
}

function parseU128String(s: unknown, field: string): bigint {
  if (s === undefined || s === null) throw new Error(`${field} is required`);
  const str = String(s).trim();
  if (!/^\d+$/.test(str)) throw new Error(`${field} must be a decimal u128 string`);
  const v = BigInt(str);
  if (v < 0n || v > U128_MAX) throw new Error(`${field} out of u128 range`);
  return v;
}

function parseNonce(s: unknown): bigint | null {
  if (s === undefined || s === null || s === '') return null;
  const str = String(s).trim();
  if (!/^\d+$/.test(str)) throw new Error('nonce must be a decimal u64 string');
  const v = BigInt(str);
  if (v < 0n || v > 0xffff_ffff_ffff_ffffn) throw new Error('nonce out of u64 range');
  return v;
}

function hexToBytesFlexible(hex: string, field: string): Uint8Array {
  const h = hex.replace(/^0x/i, '');
  if (h.length % 2 !== 0) throw new Error(`${field}: invalid hex length`);
  if (!/^[0-9a-fA-F]*$/.test(h)) throw new Error(`${field}: invalid hex`);
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

export type BoingDappTxRequestJson = Record<string, unknown>;

export function transactionSummary(tx: Transaction): string {
  const from = formatAddress(tx.sender, true);
  const n = tx.nonce.toString();
  const p = tx.payload;
  switch (p.kind) {
    case 'transfer':
      return `Boing tx | From ${from} | Nonce ${n} | Transfer ${p.amount.toString()} to ${formatAddress(p.to, true)}`;
    case 'bond':
      return `Boing tx | From ${from} | Nonce ${n} | Bond ${p.amount.toString()} stake`;
    case 'unbond':
      return `Boing tx | From ${from} | Nonce ${n} | Unbond ${p.amount.toString()} stake`;
    case 'contract_call':
      return `Boing tx | From ${from} | Nonce ${n} | Call contract ${formatAddress(p.contract, true)} | calldata ${p.calldata.length} bytes`;
    case 'contract_deploy':
      return `Boing tx | From ${from} | Nonce ${n} | Deploy contract | bytecode ${p.bytecode.length} bytes`;
    case 'contract_deploy_purpose':
      return `Boing tx | From ${from} | Nonce ${n} | Deploy (purpose: ${p.purpose_category}) | bytecode ${p.bytecode.length} bytes`;
    case 'contract_deploy_meta':
      return `Boing tx | From ${from} | Nonce ${n} | Deploy + metadata (${p.purpose_category}) | bytecode ${p.bytecode.length} bytes`;
    default: {
      const _e: never = p;
      return _e;
    }
  }
}

/**
 * Build unsigned Transaction from dApp JSON. Caller supplies sender + nonce resolution.
 */
export function transactionFromDappJson(
  raw: unknown,
  sender: AccountId,
  nonce: bigint
): Transaction {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Transaction request must be a JSON object');
  }
  const o = raw as BoingDappTxRequestJson;
  const type = o.type ?? o.txType;
  if (typeof type !== 'string') {
    throw new Error('Missing type (e.g. transfer, contract_deploy)');
  }

  let payload: Payload;

  switch (type) {
    case 'transfer': {
      const to = accountIdFromHex(String(o.to ?? ''));
      const amount = parseU128String(o.amount, 'amount');
      payload = { kind: 'transfer', to, amount };
      break;
    }
    case 'bond': {
      payload = { kind: 'bond', amount: parseU128String(o.amount, 'amount') };
      break;
    }
    case 'unbond': {
      payload = { kind: 'unbond', amount: parseU128String(o.amount, 'amount') };
      break;
    }
    case 'contract_call': {
      const contract = accountIdFromHex(String(o.contract ?? ''));
      const calldata = hexToBytesFlexible(String(o.calldata ?? '0x'), 'calldata');
      payload = { kind: 'contract_call', contract, calldata };
      break;
    }
    case 'contract_deploy': {
      throw new Error(
        'type "contract_deploy" is not accepted from dApps. Use contract_deploy_purpose or contract_deploy_meta with a valid purpose_category (Boing protocol QA).'
      );
    }
    case 'contract_deploy_purpose': {
      const bytecode = hexToBytesFlexible(String(o.bytecode ?? '0x'), 'bytecode');
      const purpose_category = String(o.purpose_category ?? o.purposeCategory ?? '').trim();
      if (!purpose_category) throw new Error('purpose_category is required');
      assertValidQaPurposeCategory(purpose_category);
      let description_hash: Uint8Array | null = null;
      const dh = o.description_hash ?? o.descriptionHash;
      if (dh != null && dh !== '') {
        description_hash = hexToBytesFlexible(String(dh), 'description_hash');
      }
      payload = { kind: 'contract_deploy_purpose', bytecode, purpose_category, description_hash };
      break;
    }
    case 'contract_deploy_meta': {
      const bytecode = hexToBytesFlexible(String(o.bytecode ?? '0x'), 'bytecode');
      let description_hash: Uint8Array | null = null;
      const dh = o.description_hash ?? o.descriptionHash;
      if (dh != null && dh !== '') {
        description_hash = hexToBytesFlexible(String(dh), 'description_hash');
      }
      const asset_name =
        o.asset_name != null && o.asset_name !== ''
          ? String(o.asset_name)
          : o.assetName != null && o.assetName !== ''
            ? String(o.assetName)
            : null;
      const asset_symbol =
        o.asset_symbol != null && o.asset_symbol !== ''
          ? String(o.asset_symbol)
          : o.assetSymbol != null && o.assetSymbol !== ''
            ? String(o.assetSymbol)
            : null;
      let purpose_category = String(o.purpose_category ?? o.purposeCategory ?? '').trim();
      if (!purpose_category) {
        if (asset_name != null || asset_symbol != null) {
          purpose_category = 'token';
        } else {
          throw new Error(
            'purpose_category is required for contract_deploy_meta (or set asset_name / asset_symbol to default purpose to "token")'
          );
        }
      }
      assertValidQaPurposeCategory(purpose_category);
      payload = {
        kind: 'contract_deploy_meta',
        bytecode,
        purpose_category,
        description_hash,
        asset_name,
        asset_symbol,
      };
      break;
    }
    default:
      throw new Error(`Unsupported transaction type: ${type}`);
  }

  const overrideNonce = parseNonce(o.nonce);
  const finalNonce = overrideNonce !== null ? overrideNonce : nonce;

  return {
    nonce: finalNonce,
    sender,
    payload,
    access_list: emptyAccessList(),
  };
}

export function assertFromMatchesSender(request: unknown, senderHex: string): void {
  if (!request || typeof request !== 'object') return;
  const from = (request as BoingDappTxRequestJson).from;
  if (from === undefined || from === null || from === '') return;
  const want = senderHex.replace(/^0x/i, '').toLowerCase();
  const got = String(from).replace(/^0x/i, '').toLowerCase();
  if (got !== want) {
    throw new Error(`from does not match active account (expected 0x${want})`);
  }
}

export { accountIdToHex };
