/**
 * QA Pillar — Contract deployment validation (client-side).
 * Aligned with TECHNICAL-SPECIFICATION.md §7 (VM & Bytecode) and QUALITY-ASSURANCE-NETWORK.md.
 * REJECT | ALLOW | UNSURE per QUALITY-ASSURANCE-NETWORK.
 */

export type QaResultStatus = 'allow' | 'reject' | 'unsure';

export interface QaResult {
  result: QaResultStatus;
  ruleId?: string;
  message?: string;
  docUrl?: string;
}

/** Max contract size: 32 KiB per TECHNICAL-SPECIFICATION §7.4 */
export const MAX_CONTRACT_SIZE = 32 * 1024;

/**
 * Boing VM opcodes (TECHNICAL-SPECIFICATION §7.2): stack-based, simplified.
 * Stop, Add, Sub, Mul, MLoad, MStore, SLoad, SStore, Jump, JumpI, Push1..Push32, Return.
 */
const BOING_OPCODES_VALID = new Set<number>([
  0x00, // Stop
  0x01, 0x02, 0x03, // Add, Sub, Mul
  0x51, 0x52, // MLoad, MStore
  0x54, 0x55, // SLoad, SStore
  0x56, 0x57, // Jump, JumpI
  0xf3, // Return
]);

/** PUSH1 (0x60) through PUSH32 (0x7f). Immediate length = byte - 0x5f (TECHNICAL-SPEC §7.2). */
const PUSH1 = 0x60;
const PUSH32 = 0x7f;

function isPushOpcode(op: number): boolean {
  return op >= PUSH1 && op <= PUSH32;
}

/** PUSH immediate length per spec: byte - 0x5f. PUSH1 = 1 byte, PUSH32 = 32 bytes. */
function pushOpcodeLength(op: number): number {
  return op - 0x5f;
}

/** Known valid Boing opcodes. Unknown → INVALID_OPCODE (reject) or UNSURE per protocol. */
function isKnownValidOpcode(op: number): boolean {
  return BOING_OPCODES_VALID.has(op) || isPushOpcode(op);
}

type OpcodeCheckResult =
  | { status: 'allow' }
  | { status: 'reject'; at: number; ruleId: string; message: string }
  | { status: 'unsure'; at: number };

/**
 * Parse bytecode and validate opcodes per TECHNICAL-SPECIFICATION §7.3.
 * REJECT: invalid opcode (INVALID_OPCODE), malformed PUSH (MALFORMED_BYTECODE).
 * UNSURE: edge cases → pool (e.g. trailing bytes; protocol may treat as reject).
 * ALLOW: all valid Boing opcodes, well-formed.
 * Note: BLOCKLIST_MATCH is bytecode-hash-based, enforced server-side only.
 */
function validateOpcodes(bytes: Uint8Array): OpcodeCheckResult {
  let i = 0;
  while (i < bytes.length) {
    const op = bytes[i];
    if (isPushOpcode(op)) {
      const len = pushOpcodeLength(op);
      if (i + len > bytes.length) {
        return {
          status: 'reject',
          at: i,
          ruleId: 'MALFORMED_BYTECODE',
          message: `Truncated PUSH at offset ${i}; bytecode extends past end.`,
        };
      }
      i += len;
    } else if (isKnownValidOpcode(op)) {
      i += 1;
    } else {
      return {
        status: 'reject',
        at: i,
        ruleId: 'INVALID_OPCODE',
        message: `Invalid opcode 0x${op.toString(16).padStart(2, '0')} at offset ${i}. Use only Boing VM opcodes.`,
      };
    }
  }
  return { status: 'allow' };
}

/**
 * Client-side QA validation for contract bytecode.
 * Returns REJECT | ALLOW | UNSURE per the QA Pillar flow.
 */
export function validateContractBytecode(
  bytecode: Uint8Array | string,
  options?: { maxSize?: number }
): QaResult {
  const maxSize = options?.maxSize ?? MAX_CONTRACT_SIZE;

  let bytes: Uint8Array;
  if (typeof bytecode === 'string') {
    const hex = bytecode.replace(/\s/g, '').replace(/^0x/i, '');
    if (hex.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(hex)) {
      return {
        result: 'reject',
        ruleId: 'MALFORMED_BYTECODE',
        message: 'Bytecode must be valid hex (even length, 0-9a-f).',
      };
    }
    bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < hex.length; i += 2) {
      bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
    }
  } else {
    bytes = bytecode;
  }

  // Empty
  if (bytes.length === 0) {
    return {
      result: 'reject',
      ruleId: 'MALFORMED_BYTECODE',
      message: 'Contract bytecode cannot be empty.',
    };
  }

  if (bytes.length > maxSize) {
    return {
      result: 'reject',
      ruleId: 'MAX_BYTECODE_SIZE',
      message: `Bytecode exceeds 32 KiB (got ${bytes.length} bytes). Shrink or split contract.`,
    };
  }

  // Opcode checks: REJECT (blocklisted, malformed) | UNSURE (unknown opcode) | ALLOW
  const opcodeCheck = validateOpcodes(bytes);
  if (opcodeCheck.status === 'reject') {
    return {
      result: 'reject',
      ruleId: opcodeCheck.ruleId,
      message: opcodeCheck.message,
    };
  }
  if (opcodeCheck.status === 'unsure') {
    return {
      result: 'unsure',
      ruleId: 'UNSURE',
      message: 'Edge case — may require community QA pool review. Use boing_qaCheck for protocol result.',
    };
  }

  return {
    result: 'allow',
    ruleId: 'CLIENT_ALLOW',
    message: 'Bytecode passed client-side QA. Use boing_qaCheck for protocol validation (blocklist, purpose).',
  };
}

/** Valid purpose categories per QUALITY-ASSURANCE-NETWORK (ContractDeployWithPurpose) */
export const VALID_PURPOSE_CATEGORIES = [
  'dApp', 'dapp', 'token', 'NFT', 'nft', 'meme', 'community',
  'entertainment', 'tooling', 'other',
] as const;
