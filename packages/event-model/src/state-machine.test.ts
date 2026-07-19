import assert from "node:assert/strict";
import type { RunEvent } from "./events";
import { finalState, initialState, replayTo } from "./state-machine";

let seq = 0;
let t = 1_000;
const ev = (event: RunEvent["event"], simulated = false): RunEvent => ({
  seq: seq++,
  at: (t += 500),
  simulated,
  event,
});

const run: RunEvent[] = [
  ev({ type: "HEARTBEAT", at: 1500, nextAt: 31500 }),
  ev({ type: "FINAL_RECORD_OBSERVED", fixtureId: "982341", sequence: "184" }),
  ev({ type: "PROOF_AVAILABLE", proofHash: "0xaa", rootPda: "Root111" }),
  ev({ type: "LEVEL3_RPC_RESULT", provider: "rpc-a", agreed: true, simulationDigest: "0xd1" }),
  ev({ type: "LEVEL3_RPC_RESULT", provider: "rpc-b", agreed: true, simulationDigest: "0xd1" }),
  ev({ type: "LEVEL3_BASE_FINALIZED", txHash: "0xL3" }),
  ev({ type: "PROOF_STAGED", solanaSignature: "sig1" }, true),
  ev({ type: "SOLANA_VERIFY_SUBMITTED", signature: "sig2" }, true),
  ev({ type: "TXLINE_CPI_VERIFIED", slot: 1234567 }, true),
  ev({ type: "WORMHOLE_MESSAGE_PUBLISHED", emitter: "Emit1", sequence: "184" }, true),
  ev({ type: "VAA_READY", vaaHash: "0xv", signatures: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] }, true),
  ev({ type: "LEVEL4_BASE_SUBMITTED", txHash: "0xL4" }),
  ev({ type: "BASE_VAA_VERIFIED", blockNumber: 99 }),
  ev({ type: "DUAL_FINALITY_REACHED", attestationId: "0xatt" }),
  ev({ type: "CONSUMER_SETTLED", txHash: "0xsettle" }),
];

// initial
assert.equal(initialState().finality, "Unknown");
assert.equal(initialState().steps[0].state, "active");

// mid-replay: after L3 lands but before L4
const mid = replayTo(run, 5);
assert.equal(mid.finality, "CREAttested");
assert.equal(mid.level3.status, "done");
assert.equal(mid.level4.status, "in_progress");
assert.equal(mid.level3.rpcResults.length, 2);

// final
const fin = finalState(run);
assert.equal(fin.finality, "DualFinalized");
assert.equal(fin.attestationId, "0xatt");
assert.equal(fin.settledTxHash, "0xsettle");
assert.ok(fin.steps.every((s) => s.state === "done"));
assert.equal(fin.level4.guardianSignatures.length, 13);

// determinism: same events → same state
assert.deepEqual(finalState(run), fin);

// failure path
const failRun = [...run.slice(0, 9), ev({ type: "RUN_FAILED", stage: "level4/vaa", reason: "quorum timeout" })];
const failed = finalState(failRun);
assert.equal(failed.level4.status, "failed");
assert.ok(failed.failure);

console.log("event-model: all tests passed");
