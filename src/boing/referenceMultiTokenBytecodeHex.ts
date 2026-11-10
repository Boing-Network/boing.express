/**
 * Reference multi-token v1 bytecode, taken from `@boing-network/boing-sdk` (>= 0.5.41) so the wallet's
 * template identity check cannot drift from the published SDK. Lowercase hex without `0x`.
 */
import {
  DEFAULT_REFERENCE_MULTI_TOKEN_DEPLOY_BYTECODE_HEX,
  DEFAULT_REFERENCE_MULTI_TOKEN_RUNTIME_BYTECODE_HEX,
} from '@boing-network/boing-sdk';

const bare = (h: string) => h.trim().replace(/^0x/i, '').toLowerCase();

/** Installed runtime (what `boing_getContractCode` returns after deploy). */
export const REFERENCE_MULTI_TOKEN_RUNTIME_HEX = bare(DEFAULT_REFERENCE_MULTI_TOKEN_RUNTIME_BYTECODE_HEX);

/** Deploy payload (`0xFD` init: admin = deployer, returns the runtime). */
export const REFERENCE_MULTI_TOKEN_DEPLOY_HEX = bare(DEFAULT_REFERENCE_MULTI_TOKEN_DEPLOY_BYTECODE_HEX);
