/**
 * QA Pillar — Contract deployment validation (client-side).
 * Mirrors the ContractDeploy flow: REJECT | ALLOW | UNSURE.
 * Use before submit; also supports boing_qaCheck RPC when available.
 *
 * REJECT (hard): empty, oversized, invalid opcode, malformed, blocklisted, bad purpose
 * ALLOW: valid opcodes, well-formed, not blocklisted, valid purpose (or none)
 * UNSURE: edge cases → community QA pool (pool not yet used in current code)
 */

export type QaResultStatus = 'allow' | 'reject' | 'unsure';

export interface QaResult {
  result: QaResultStatus;
  ruleId?: string;
  message?: string;
}

/** Max contract size in bytes (configurable; Ethereum uses 24KB). */
export const MAX_CONTRACT_SIZE = 24 * 1024;

/**
 * EVM opcodes 0x00-0x5f (stack, memory, storage, flow control) — commonly valid.
 * Boing may use EVM-like or custom VM; this set is conservative.
 * Invalid = any byte not in a known opcode range.
 */
const EVM_OPCODES_VALID = new Set<number>([
  0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09,
  0x0a, 0x0b, 0x10, 0x11, 0x12, 0x13, 0x14, 0x15, 0x16, 0x17,
  0x18, 0x19, 0x1a, 0x1b, 0x20, 0x30, 0x31, 0x32, 0x33, 0x34,
  0x35, 0x36, 0x37, 0x38, 0x39, 0x3a, 0x3b, 0x3c, 0x3d, 0x3e,
  0x3f, 0x40, 0x41, 0x42, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48,
  0x49, 0x4a, 0x4b, 0x4c, 0x4d, 0x4e, 0x4f, 0x50, 0x51, 0x52,
  0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59, 0x5a, 0x5b, 0x5c,
  0x5d, 0x5e, 0x5f,
]);

/**
 * Push opcodes: PUSH1 (0x60) through PUSH32 (0x7f).
 * Each takes 1–32 trailing bytes (immediate data).
 */
const PUSH1 = 0x60;
const PUSH32 = 0x7f;

/**
 * Opcodes that read variable-length immediate data.
 * PUSH1..PUSH32: 1 + (opcode - 0x60) bytes.
 */
function isPushOpcode(op: number): boolean {
  return op >= PUSH1 && op <= PUSH32;
}

function pushOpcodeLength(op: number): number {
  return 1 + (op - PUSH1 + 1);
}

/** Blocklisted opcodes (dangerous or disallowed by protocol). Configurable. */
const BLOCKLISTED_OPCODES = new Set<number>([
  0xff, // SELFDESTRUCT
  // Add more per Boing protocol rules when defined
]);

/** Known valid opcodes (EVM standard). Unknown → UNSURE (pool). */
function isKnownValidOpcode(op: number): boolean {
  if (EVM_OPCODES_VALID.has(op)) return true;
  if (isPushOpcode(op)) return true;
  if (op >= 0x80 && op <= 0xef) return true; // EXT opcodes
  if ([0xf0, 0xf1, 0xfa, 0xfb, 0xfc, 0xfd].includes(op)) return true;
  return false;
}

type OpcodeCheckResult =
  | { status: 'allow' }
  | { status: 'reject'; at: number; ruleId: string; message: string }
  | { status: 'unsure'; at: number };

/**
 * Parse bytecode and validate opcodes.
 * REJECT: blocklisted, malformed (PUSH past end).
 * UNSURE: unknown opcode (not in known set) → pool.
 * ALLOW: all known valid.
 */
function validateOpcodes(bytes: Uint8Array): OpcodeCheckResult {
  let i = 0;
  while (i < bytes.length) {
    const op = bytes[i];
    if (BLOCKLISTED_OPCODES.has(op)) {
      return {
        status: 'reject',
        at: i,
        ruleId: 'qa_blocklisted',
        message: `Blocklisted opcode 0x${op.toString(16).padStart(2, '0')} at offset ${i}.`,
      };
    }
    if (isPushOpcode(op)) {
      const len = pushOpcodeLength(op);
      if (i + len > bytes.length) {
        return {
          status: 'reject',
          at: i,
          ruleId: 'qa_malformed',
          message: `Malformed: PUSH opcode at offset ${i} extends past end of bytecode.`,
        };
      }
      i += len;
    } else if (isKnownValidOpcode(op)) {
      i += 1;
    } else {
      return { status: 'unsure', at: i };
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
        ruleId: 'qa_malformed_hex',
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
      ruleId: 'qa_empty',
      message: 'Contract bytecode cannot be empty.',
    };
  }

  // Oversized
  if (bytes.length > maxSize) {
    return {
      result: 'reject',
      ruleId: 'qa_oversized',
      message: `Contract exceeds max size (${maxSize} bytes). Got ${bytes.length} bytes.`,
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
    const op = bytes[opcodeCheck.at];
    return {
      result: 'unsure',
      ruleId: 'qa_unknown_opcode',
      message: `Unknown opcode 0x${op.toString(16).padStart(2, '0')} at offset ${opcodeCheck.at}. May require community QA pool review.`,
    };
  }

  // Well-formed, valid opcodes, not blocklisted → ALLOW
  return {
    result: 'allow',
    ruleId: 'qa_client_allow',
    message: 'Bytecode passed client-side QA checks. Use boing_qaCheck for protocol validation.',
  };
}
