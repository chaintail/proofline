/** Minimal dependency-free test runner (deadline-day pragmatism). */
import assert from "node:assert/strict";
import {
  encodeMatchOutcomeV1,
  decodeMatchOutcomeV1,
  bytesToHex,
  type MatchOutcomeV1,
} from "./payload";
import { attestationId, DOMAIN_SEPARATOR } from "./attestation-id";
import { base58ToHex32, canonicalJson } from "./hashing";
import { MATCH_OUTCOME_V1_LENGTH, RESULT } from "./constants";

const sample: MatchOutcomeV1 = {
  flags: 0,
  destinationChain: 10004,
  sourceValidationVersion: 2,
  result: RESULT.HOME,
  fixtureId: 982341n,
  scoreSequence: 184n,
  proofTimestampMs: 1784498100000n,
  period: 100,
  participant1Score: 2,
  participant2Score: 1,
  txlineProgramId: base58ToHex32("9ExbZjAapQww1vfcisDmrngPinHTEfpjYRWMunJgcKaA"),
  dailyRootAccount: `0x${"11".repeat(32)}`,
  validationInstructionHash: `0x${"22".repeat(32)}`,
  proofBundleHash: `0x${"33".repeat(32)}`,
};

// roundtrip
const enc = encodeMatchOutcomeV1(sample);
assert.equal(enc.length, MATCH_OUTCOME_V1_LENGTH);
assert.deepEqual(decodeMatchOutcomeV1(enc), sample);

// magic + version guards
assert.equal(bytesToHex(enc.slice(0, 4)), "0x5052464c");
assert.throws(() => decodeMatchOutcomeV1(enc.slice(1)));
const tampered = enc.slice();
tampered[0] = 0x00;
assert.throws(() => decodeMatchOutcomeV1(tampered));

// negative i64 roundtrip
const neg = { ...sample, fixtureId: -5n };
assert.deepEqual(decodeMatchOutcomeV1(encodeMatchOutcomeV1(neg)).fixtureId, -5n);

// attestation id is stable + sensitive to every input
const base = {
  sourceEmitter: `0x${"aa".repeat(32)}` as const,
  fixtureId: 982341n,
  scoreSequence: 184n,
  validationInstructionHash: `0x${"22".repeat(32)}` as const,
  proofBundleHash: `0x${"33".repeat(32)}` as const,
};
const id1 = attestationId(base);
assert.equal(id1, attestationId({ ...base }));
assert.notEqual(id1, attestationId({ ...base, scoreSequence: 185n }));
assert.notEqual(id1, attestationId({ ...base, proofBundleHash: `0x${"34".repeat(32)}` }));
assert.equal(DOMAIN_SEPARATOR.length, 66);

// canonical json determinism
assert.equal(canonicalJson({ b: 1, a: [2, { d: 3, c: 4 }] }), '{"a":[2,{"c":4,"d":3}],"b":1}');

console.log("protocol: all tests passed");
