import { describe, expect, it } from 'vitest';
import * as ed from '@noble/ed25519';
import {
  buildRegisterPayload,
  bytesToHex,
  canUnjail,
  parseNodeSecretHex,
  registrationAvailability,
  validatorRegistrationMessage,
  validatorRegistrationMessageV2,
  validatorsOwnedBy,
  verifyRegistration,
  type ValidatorsReport,
} from '../src/boing/openValidator';
import { encodePayload } from '../src/boing/bincode';
import { suggestedAccessList } from '../src/boing/accessList';

const owner = new Uint8Array(32).fill(9);
const nodeSeed = new Uint8Array(32).fill(7);

describe('open validator registration', () => {
  it('matches the Rust golden vector', async () => {
    const nodeId = await ed.getPublicKeyAsync(nodeSeed);
    expect(bytesToHex(nodeId)).toBe('ea4a6c63e29c520abef5507b132ec5f9954776aebebe7b92421eea691446d22c');
    expect(bytesToHex(validatorRegistrationMessage(owner, nodeId))).toBe(
      'f8bbe9cbc961743405a6154a8dd07192efa73a3e9368271ec4b11dd0b66562b5'
    );
  });

  it('v2 proof matches the Rust golden vector and is chain-bound (security #14)', async () => {
    const nodeId = await ed.getPublicKeyAsync(nodeSeed);
    expect(bytesToHex(validatorRegistrationMessageV2(owner, nodeId, 6913))).toBe(
      '2d9b960878d673d6e84ded770590a0242fdc66ac4f34ca9d158078c7bf4b59d9'
    );
    const p = await buildRegisterPayload(owner, nodeSeed, 6913n);
    if (p.kind !== 'validator_register') throw new Error('kind');
    expect(await verifyRegistration(owner, p.node_id, p.node_signature, 6913n)).toBe(true);
    expect(await verifyRegistration(owner, p.node_id, p.node_signature, 6914n)).toBe(false);
    expect(await verifyRegistration(owner, p.node_id, p.node_signature)).toBe(false);
  });

  it('builds a register payload whose proof verifies and binds the owner', async () => {
    const p = await buildRegisterPayload(owner, nodeSeed);
    if (p.kind !== 'validator_register') throw new Error('kind');
    expect(await verifyRegistration(owner, p.node_id, p.node_signature)).toBe(true);
    expect(await verifyRegistration(new Uint8Array(32).fill(1), p.node_id, p.node_signature)).toBe(false);
    const enc = encodePayload(p);
    expect(Array.from(enc.slice(0, 4))).toEqual([10, 0, 0, 0]);
    expect(enc.length).toBe(4 + 32 + 8 + 64);
    expect(Array.from(enc.slice(36, 44))).toEqual([64, 0, 0, 0, 0, 0, 0, 0]);
  });

  it('encodes deregister / unjail and uses a sender-only access list', () => {
    const node = new Uint8Array(32).fill(3);
    expect(Array.from(encodePayload({ kind: 'validator_deregister', node_id: node }).slice(0, 4))).toEqual([11, 0, 0, 0]);
    expect(encodePayload({ kind: 'validator_unjail', node_id: node }).length).toBe(36);
    const al = suggestedAccessList(owner, { kind: 'validator_unjail', node_id: node });
    expect(al.read).toEqual([owner]);
    expect(al.write).toEqual([owner]);
  });

  it('parses node keys strictly', () => {
    expect(parseNodeSecretHex('0x' + '07'.repeat(32))).toEqual(nodeSeed);
    expect(() => parseNodeSecretHex('abc')).toThrow(/64 hex/);
    expect(() => parseNodeSecretHex('zz'.repeat(32))).toThrow();
  });

  it('availability, ownership and unjail gating', () => {
    expect(registrationAvailability(null)).toEqual({ state: 'unsupported' });
    const base: ValidatorsReport = { mode: 'static', height: 50, quorum: 1, validator_count: 1, open: null, validators: [] };
    expect(registrationAvailability(base).state).toBe('not_open');
    const open = {
      activation_height: 100, activated_at: null, bond: '100', deregister_delay: 100, epoch_len: 100,
      next_epoch_height: 100, max_open_validators: 20, liveness_window: 1000, miss_threshold_bps: 1000, jail_cooldown: 500,
    };
    expect(registrationAvailability({ ...base, mode: 'open', open })).toEqual({ state: 'scheduled', activationHeight: 100, height: 50 });
    const r: ValidatorsReport = {
      ...base, mode: 'open', open: { ...open, activated_at: 100 },
      validators: [{
        id: '0xaa', kind: 'open', status: 'jailed', in_set: false, owner: '0x' + '09'.repeat(32), bond: '100',
        registered_at: 101, jailed_until: 60, jail_count: 1, scheduled_proposals: 10, missed_proposals: 10, uptime_pct: 0,
      }],
    };
    expect(registrationAvailability(r).state).toBe('open');
    const mine = validatorsOwnedBy(r, '09'.repeat(32).toUpperCase());
    expect(mine).toHaveLength(1);
    expect(canUnjail(mine[0], 50)).toBe(false);
    expect(canUnjail(mine[0], 60)).toBe(true);
  });
});
