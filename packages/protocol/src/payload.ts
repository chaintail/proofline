/**
 * MatchOutcomeV1 — the fixed-width, versioned, domain-separated cross-chain
 * payload. This is deliberately NOT a mirror of TxLINE's Solana account
 * structure: Base consumers get a compact, stable application message.
 *
 * All multi-byte integers are big-endian (network order — matches Wormhole
 * payload conventions and cheap Solidity slicing).
 *
 * Layout (176 bytes total):
 *   offset  size  field
 *   0       4     magic "PRFL"
 *   4       1     version (1)
 *   5       1     message_type (1 = MATCH_OUTCOME)
 *   6       2     flags
 *   8       2     destination_chain (Wormhole chain id)
 *   10      1     source_validation_version (1|2|3)
 *   11      1     result (1=HOME 2=DRAW 3=AWAY)
 *   12      8     fixture_id (i64)
 *   20      8     score_sequence (i64)
 *   28      8     proof_timestamp_ms (i64)
 *   36      4     period (i32)
 *   40      4     participant_1_score (i32)
 *   44      4     participant_2_score (i32)
 *   48      32    txline_program_id
 *   80      32    daily_root_account
 *   112     32    validation_instruction_hash
 *   144     32    proof_bundle_hash
 */
import {
  MATCH_OUTCOME_V1_LENGTH,
  MESSAGE_TYPE_MATCH_OUTCOME,
  PAYLOAD_MAGIC,
  PAYLOAD_VERSION,
  type ResultCode,
} from "./constants";

export interface MatchOutcomeV1 {
  flags: number;
  destinationChain: number;
  sourceValidationVersion: number;
  result: ResultCode;
  fixtureId: bigint;
  scoreSequence: bigint;
  proofTimestampMs: bigint;
  period: number;
  participant1Score: number;
  participant2Score: number;
  /** 32-byte values as 0x-hex strings */
  txlineProgramId: `0x${string}`;
  dailyRootAccount: `0x${string}`;
  validationInstructionHash: `0x${string}`;
  proofBundleHash: `0x${string}`;
}

function hex32ToBytes(hex: `0x${string}`, label: string): Uint8Array {
  const clean = hex.slice(2);
  if (clean.length !== 64) throw new Error(`${label}: expected 32 bytes, got ${clean.length / 2}`);
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function bytesToHex(bytes: Uint8Array): `0x${string}` {
  return `0x${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}` as `0x${string}`;
}

export function encodeMatchOutcomeV1(o: MatchOutcomeV1): Uint8Array {
  const buf = new Uint8Array(MATCH_OUTCOME_V1_LENGTH);
  const dv = new DataView(buf.buffer);
  buf.set(PAYLOAD_MAGIC, 0);
  dv.setUint8(4, PAYLOAD_VERSION);
  dv.setUint8(5, MESSAGE_TYPE_MATCH_OUTCOME);
  dv.setUint16(6, o.flags, false);
  dv.setUint16(8, o.destinationChain, false);
  dv.setUint8(10, o.sourceValidationVersion);
  dv.setUint8(11, o.result);
  dv.setBigInt64(12, o.fixtureId, false);
  dv.setBigInt64(20, o.scoreSequence, false);
  dv.setBigInt64(28, o.proofTimestampMs, false);
  dv.setInt32(36, o.period, false);
  dv.setInt32(40, o.participant1Score, false);
  dv.setInt32(44, o.participant2Score, false);
  buf.set(hex32ToBytes(o.txlineProgramId, "txlineProgramId"), 48);
  buf.set(hex32ToBytes(o.dailyRootAccount, "dailyRootAccount"), 80);
  buf.set(hex32ToBytes(o.validationInstructionHash, "validationInstructionHash"), 112);
  buf.set(hex32ToBytes(o.proofBundleHash, "proofBundleHash"), 144);
  return buf;
}

export class PayloadDecodeError extends Error {}

export function decodeMatchOutcomeV1(bytes: Uint8Array): MatchOutcomeV1 {
  if (bytes.length !== MATCH_OUTCOME_V1_LENGTH)
    throw new PayloadDecodeError(`bad length ${bytes.length}, want ${MATCH_OUTCOME_V1_LENGTH}`);
  for (let i = 0; i < 4; i++)
    if (bytes[i] !== PAYLOAD_MAGIC[i]) throw new PayloadDecodeError("bad magic");
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (dv.getUint8(4) !== PAYLOAD_VERSION) throw new PayloadDecodeError("unsupported version");
  if (dv.getUint8(5) !== MESSAGE_TYPE_MATCH_OUTCOME)
    throw new PayloadDecodeError("unsupported message type");
  const result = dv.getUint8(11);
  if (result < 1 || result > 3) throw new PayloadDecodeError("invalid result code");
  const slice32 = (off: number) => bytesToHex(bytes.slice(off, off + 32));
  return {
    flags: dv.getUint16(6, false),
    destinationChain: dv.getUint16(8, false),
    sourceValidationVersion: dv.getUint8(10),
    result: result as ResultCode,
    fixtureId: dv.getBigInt64(12, false),
    scoreSequence: dv.getBigInt64(20, false),
    proofTimestampMs: dv.getBigInt64(28, false),
    period: dv.getInt32(36, false),
    participant1Score: dv.getInt32(40, false),
    participant2Score: dv.getInt32(44, false),
    txlineProgramId: slice32(48),
    dailyRootAccount: slice32(80),
    validationInstructionHash: slice32(112),
    proofBundleHash: slice32(144),
  };
}
