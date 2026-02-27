# Boing Express — Alignment with Boing Network Specs

This document summarizes how the boing.express wallet aligns with the six reference documents in the boing-network repository.

---

## Reference Documents

| Document | Purpose |
|----------|---------|
| [SIX-PILLARS-READINESS.md](https://github.com/chiku524/boing-network/blob/main/docs/SIX-PILLARS-READINESS.md) | Six pillars assessment |
| [TECHNICAL-SPECIFICATION.md](https://github.com/chiku524/boing-network/blob/main/docs/TECHNICAL-SPECIFICATION.md) | Cryptography, data formats, VM, RPC |
| [CANONICAL-MALICE-DEFINITION.md](https://github.com/chiku524/boing-network/blob/main/docs/CANONICAL-MALICE-DEFINITION.md) | Malice categories for QA pool |
| [QA-PASS-GUIDE.md](https://github.com/chiku524/boing-network/blob/main/docs/QA-PASS-GUIDE.md) | Deployer checklist, purpose categories |
| [RUNBOOK.md](https://github.com/chiku524/boing-network/blob/main/docs/RUNBOOK.md) | Node ops, RPC, incident response |
| [SECURITY-STANDARDS.md](https://github.com/chiku524/boing-network/blob/main/docs/SECURITY-STANDARDS.md) | Security requirements, contacts |

---

## Alignment Summary

### Pillar 1: Security (SIX-PILLARS, SECURITY-STANDARDS)

| Item | Status |
|------|--------|
| Ed25519 signatures | ✓ `@noble/ed25519` |
| BLAKE3 hashing | ✓ `@noble/hashes/blake3` |
| Keys never sent to server | ✓ Client-only; encrypted in storage |
| Password-derived encryption | ✓ PBKDF2 + AES-GCM |

### Pillar 2–4: Scalability, Decentralization, Authenticity

These apply primarily to the network and node layer. The wallet uses the RPC interface and does not implement consensus, P2P, or VM execution.

### Pillar 5: Transparency

| Item | Status |
|------|--------|
| Open docs | ✓ /docs, /privacy, /support |
| QA rejection details | ✓ rule_id, message in RPC errors |
| Canonical malice reference | ✓ Linked in QA Pillar doc |
| QA-PASS-GUIDE reference | ✓ Linked; purpose categories in UI |

### Pillar 6: True Quality Assurance (TECHNICAL-SPEC, QA-PASS-GUIDE)

| Item | Spec | Wallet |
|------|------|--------|
| Max bytecode size | 32 KiB | ✓ MAX_CONTRACT_SIZE = 32 × 1024 |
| Boing VM opcodes | Stop, Add, Sub, Mul, MLoad, MStore, SLoad, SStore, Jump, JumpI, Push1..32, Return | ✓ Client-side validator |
| PUSH encoding | byte - 0x5f | ✓ |
| Rule IDs | MAX_BYTECODE_SIZE, INVALID_OPCODE, MALFORMED_BYTECODE | ✓ |
| boing_qaCheck RPC | [hex_bytecode] or [hex_bytecode, purpose, desc_hash?] | ✓ |
| Purpose categories | dApp, token, NFT, meme, community, entertainment, tooling, other | ✓ Selector in UI |
| Error codes -32050, -32051 | QA reject, QA pool | ✓ Mapped in rpc.ts |

### Data Structures (TECHNICAL-SPECIFICATION)

| Structure | Spec | Wallet |
|-----------|------|--------|
| AccountId | 32 bytes, 64 hex | ✓ |
| Transaction | nonce, sender, payload, access_list | ✓ |
| Payload | Transfer, Bond, Unbond, ContractCall (placeholder), ContractDeploy (placeholder) | ✓ |
| Signable message | BLAKE3(nonce_le \|\| sender \|\| bincode(payload) \|\| bincode(access_list)) | ✓ signing.ts |
| SignedTransaction | hex(bincode(tx, signature)) | ✓ |

### RPC Methods (TECHNICAL-SPEC, RUNBOOK)

| Method | Status |
|--------|--------|
| boing_submitTransaction | ✓ |
| boing_chainHeight | ✓ |
| boing_getBalance | ✓ |
| boing_getAccount | ✓ |
| boing_getNonce | ✓ (fallback) |
| boing_simulateTransaction | ✓ |
| boing_faucetRequest | ✓ |
| boing_qaCheck | ✓ |

### Incident Response (RUNBOOK §6, SECURITY-STANDARDS)

Wallet directs users to [RUNBOOK](https://github.com/chiku524/boing-network/blob/main/docs/RUNBOOK.md) and [SECURITY-STANDARDS](https://github.com/chiku524/boing-network/blob/main/docs/SECURITY-STANDARDS.md) for incident response and security contacts. GitHub Security Advisories linked for responsible disclosure.

---

## Gaps (Out of Scope or Deferred)

- **ContractDeploy / ContractDeployWithPurpose bincode**: Placeholder payloads; full deploy tx building pending boing-primitives layout confirmation.
- **ContractCall**: Placeholder; not implemented.
- **boing_qaMetrics**: Optional RPC for public QA stats; not used by wallet.
- **Blocklist check**: Bytecode-hash blocklist is enforced server-side via boing_qaCheck; client cannot check.

---

*Boing Express — Authentic. Decentralized. Optimal. Quality-Assured.*
