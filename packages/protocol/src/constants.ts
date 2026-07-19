/**
 * Single source of truth for every cross-language protocol constant.
 * Rust and Solidity copies of these values are generated/checked against
 * packages/test-vectors — do not hand-edit them independently.
 */

/** ASCII "PRFL" — payload magic. */
export const PAYLOAD_MAGIC = new Uint8Array([0x50, 0x52, 0x46, 0x4c]);
export const PAYLOAD_MAGIC_HEX = "0x5052464c" as const;

export const PAYLOAD_VERSION = 1;

/** Message types. */
export const MESSAGE_TYPE_MATCH_OUTCOME = 1;

/** Result enum — 0 is reserved so an all-zero payload can never decode as a valid outcome. */
export const RESULT = {
  HOME: 1,
  DRAW: 2,
  AWAY: 3,
} as const;
export type ResultCode = (typeof RESULT)[keyof typeof RESULT];

/** validate_stat instruction generations on TxOracle. */
export const SOURCE_VALIDATION = {
  VALIDATE_STAT: 1,
  VALIDATE_STAT_V2: 2,
  VALIDATE_STAT_V3: 3,
} as const;

/** Wormhole chain ids. */
export const WORMHOLE_CHAIN_SOLANA = 1;
export const WORMHOLE_CHAIN_BASE = 30;
export const WORMHOLE_CHAIN_BASE_SEPOLIA = 10004;

/** TxOracle mainnet program (as cited in the design research). */
export const TXORACLE_PROGRAM_ID = "9ExbZjAapQww1vfcisDmrngPinHTEfpjYRWMunJgcKaA";

/**
 * Domain separator for attestation ids.
 * keccak256(utf8("proofline.attestation.v1")) — computed, never hardcoded, in
 * attestation-id.ts; the literal string is the canonical constant.
 */
export const ATTESTATION_DOMAIN_STRING = "proofline.attestation.v1";

/** Fixed payload byte length for MatchOutcomeV1 (see payload.ts layout table). */
export const MATCH_OUTCOME_V1_LENGTH = 176;

/** TxLINE final-settlement marker (single settlement path — regulation/ET/pens/abandonment). */
export const FINAL_MARKER = {
  action: "game_finalised",
  statusId: 100,
  period: 100,
} as const;

/** Wormhole guardian set shape. */
export const GUARDIAN_SET_SIZE = 19;
export const GUARDIAN_QUORUM = 13;
