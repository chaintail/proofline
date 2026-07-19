/**
 * Generates packages/test-vectors/match-outcome-v1.json — the cross-language
 * conformance vector. Solidity (Foundry tests) and Rust (adapter tests) verify
 * their codecs against these exact bytes instead of maintaining three
 * hand-written schema copies.
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  encodeMatchOutcomeV1,
  bytesToHex,
  type MatchOutcomeV1,
} from "./payload";
import { attestationId, DOMAIN_SEPARATOR } from "./attestation-id";
import {
  validationInstructionHash,
  proofBundleHash,
  base58ToHex32,
} from "./hashing";
import {
  RESULT,
  SOURCE_VALIDATION,
  TXORACLE_PROGRAM_ID,
  WORMHOLE_CHAIN_BASE_SEPOLIA,
} from "./constants";

// Canonical demo fixture — the author's own example throughout the design:
// World Cup final, Canada 2–1 France, fixture 982341, emitter sequence 184.
const FIXTURE_ID = 982341n;
const SCORE_SEQUENCE = 184n;
const PROOF_TIMESTAMP_MS = 1784498100000n; // 2026-07-19T18:35:00Z

const txlineProgramId = base58ToHex32(TXORACLE_PROGRAM_ID);
// Deterministic placeholder PDA for the demo day root (synthetic fixture —
// the recorded run's evidence bundle carries the same value).
const dailyRootAccount = base58ToHex32("7dai1yRoots1111111111111111111111111111111");

const demoInstructionData = new TextEncoder().encode(
  "validate_stat_v2:fixture=982341:p1=2:p2=1:period=100",
);
const vih = validationInstructionHash(txlineProgramId, dailyRootAccount, demoInstructionData);
const pbh = proofBundleHash({
  finalRecord: {
    action: "game_finalised",
    fixtureId: "982341",
    statusId: 100,
    period: 100,
    participant1: "Canada",
    participant2: "France",
    participant1Score: 2,
    participant2Score: 1,
    sequence: "184",
  },
  proof: { synthetic: true, note: "deterministic demo fixture" },
  rootAccount: "7dai1yRoots1111111111111111111111111111111",
  strategy: "validate_stat_v2 exact-equality predicate",
});

const outcome: MatchOutcomeV1 = {
  flags: 0,
  destinationChain: WORMHOLE_CHAIN_BASE_SEPOLIA,
  sourceValidationVersion: SOURCE_VALIDATION.VALIDATE_STAT_V2,
  result: RESULT.HOME,
  fixtureId: FIXTURE_ID,
  scoreSequence: SCORE_SEQUENCE,
  proofTimestampMs: PROOF_TIMESTAMP_MS,
  period: 100,
  participant1Score: 2,
  participant2Score: 1,
  txlineProgramId,
  dailyRootAccount,
  validationInstructionHash: vih,
  proofBundleHash: pbh,
};

// Demo emitter: deterministic 32-byte value standing in for the adapter's
// Wormhole emitter PDA (Solana leg is simulated in this build).
const sourceEmitter = base58ToHex32("Emitter1111111111111111111111111111111111");

const vector = {
  description:
    "MatchOutcomeV1 conformance vector — Canada 2-1 France demo fixture. All implementations must reproduce encodedPayload and attestationId byte-for-byte.",
  domainSeparator: DOMAIN_SEPARATOR,
  outcome: JSON.parse(
    JSON.stringify(outcome, (_, v) => (typeof v === "bigint" ? v.toString() : v)),
  ),
  sourceEmitter,
  encodedPayload: bytesToHex(encodeMatchOutcomeV1(outcome)),
  attestationId: attestationId({
    sourceEmitter,
    fixtureId: FIXTURE_ID,
    scoreSequence: SCORE_SEQUENCE,
    validationInstructionHash: vih,
    proofBundleHash: pbh,
  }),
};

const out = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../test-vectors/match-outcome-v1.json",
);
writeFileSync(out, JSON.stringify(vector, null, 2) + "\n");
console.log(`wrote ${out}`);
console.log(`attestationId ${vector.attestationId}`);
