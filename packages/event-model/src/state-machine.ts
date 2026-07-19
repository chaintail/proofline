/**
 * Pure reducer from an ordered RunEvent stream to ControlRoomState.
 * Level 3 and Level 4 are modeled as PARALLEL lanes (per the design), not one
 * linear sequence. Live mode and replay mode both fold over this exact
 * function — same schema, same renderer.
 */
import type { RelayEventType, RunEvent } from "./events";

export type LaneStatus = "idle" | "in_progress" | "done" | "failed";
export type StepState = "pending" | "active" | "done" | "failed";

export interface StepItem {
  id: number;
  label: string;
  state: StepState;
}

export interface Level3Lane {
  status: LaneStatus;
  rpcResults: { provider: string; agreed: boolean; simulationDigest: string }[];
  baseTxHash?: string;
}

export interface Level4Lane {
  status: LaneStatus;
  proofStagedSig?: string;
  verifySig?: string;
  verifiedSlot?: number;
  wormholeEmitter?: string;
  wormholeSequence?: string;
  vaaHash?: string;
  guardianSignatures: number[];
  baseTxHash?: string;
  baseVerifiedBlock?: number;
}

export type FinalityStatus =
  | "Unknown"
  | "CREAttested"
  | "WormholeVerified"
  | "DualFinalized"
  | "Conflict";

export interface ControlRoomState {
  heartbeat: { lastAt?: number; nextAt?: number; count: number };
  finalRecord?: { fixtureId: string; sequence: string };
  proof?: { proofHash: string; rootPda: string };
  level3: Level3Lane;
  level4: Level4Lane;
  finality: FinalityStatus;
  attestationId?: string;
  settledTxHash?: string;
  failure?: { stage: string; reason: string };
  /** The 6-step CRE checklist from the control-box mockup. */
  steps: StepItem[];
  /** seq of last applied event — replay scrubbing anchor. */
  lastSeq: number;
  lastEventAt?: number;
}

const STEP_LABELS = [
  "Final record detected",
  "TxLINE proof available",
  "Verify outcome on Solana",
  "Await Wormhole VAA",
  "Relay to Base",
  "Settle consumer",
];

export function initialState(): ControlRoomState {
  return {
    heartbeat: { count: 0 },
    level3: { status: "idle", rpcResults: [] },
    level4: { status: "idle", guardianSignatures: [] },
    finality: "Unknown",
    steps: STEP_LABELS.map((label, i) => ({
      id: i + 1,
      label,
      state: i === 0 ? "active" : "pending",
    })),
    lastSeq: -1,
  };
}

function setStep(s: ControlRoomState, id: number, state: StepState) {
  const idx = id - 1;
  s.steps = s.steps.map((st, i) => {
    if (i < idx && st.state !== "failed") return { ...st, state: "done" as StepState };
    if (i === idx) return { ...st, state };
    return st;
  });
}

export function applyEvent(prev: ControlRoomState, re: RunEvent): ControlRoomState {
  const s: ControlRoomState = structuredClone(prev);
  s.lastSeq = re.seq;
  s.lastEventAt = re.at;
  const e = re.event;
  switch (e.type) {
    case "HEARTBEAT":
      s.heartbeat = { lastAt: e.at, nextAt: e.nextAt, count: s.heartbeat.count + 1 };
      break;
    case "FINAL_RECORD_OBSERVED":
      s.finalRecord = { fixtureId: e.fixtureId, sequence: e.sequence };
      setStep(s, 1, "done");
      setStep(s, 2, "active");
      break;
    case "PROOF_AVAILABLE":
      s.proof = { proofHash: e.proofHash, rootPda: e.rootPda };
      setStep(s, 2, "done");
      setStep(s, 3, "active");
      s.level3.status = "in_progress";
      s.level4.status = "in_progress";
      break;
    case "PROOF_STAGED":
      s.level4.proofStagedSig = e.solanaSignature;
      break;
    case "SOLANA_VERIFY_SUBMITTED":
      s.level4.verifySig = e.signature;
      break;
    case "TXLINE_CPI_VERIFIED":
      s.level4.verifiedSlot = e.slot;
      setStep(s, 3, "done");
      setStep(s, 4, "active");
      break;
    case "WORMHOLE_MESSAGE_PUBLISHED":
      s.level4.wormholeEmitter = e.emitter;
      s.level4.wormholeSequence = e.sequence;
      break;
    case "VAA_READY":
      s.level4.vaaHash = e.vaaHash;
      s.level4.guardianSignatures = e.signatures;
      setStep(s, 4, "done");
      setStep(s, 5, "active");
      break;
    case "LEVEL3_RPC_RESULT":
      s.level3.rpcResults = [
        ...s.level3.rpcResults.filter((r) => r.provider !== e.provider),
        { provider: e.provider, agreed: e.agreed, simulationDigest: e.simulationDigest },
      ];
      break;
    case "LEVEL3_BASE_FINALIZED":
      s.level3.baseTxHash = e.txHash;
      s.level3.status = "done";
      if (s.finality === "Unknown") s.finality = "CREAttested";
      break;
    case "LEVEL4_BASE_SUBMITTED":
      s.level4.baseTxHash = e.txHash;
      break;
    case "BASE_VAA_VERIFIED":
      s.level4.baseVerifiedBlock = e.blockNumber;
      s.level4.status = "done";
      setStep(s, 5, "done");
      setStep(s, 6, "active");
      if (s.finality === "Unknown") s.finality = "WormholeVerified";
      break;
    case "DUAL_FINALITY_REACHED":
      s.finality = "DualFinalized";
      s.attestationId = e.attestationId;
      break;
    case "CONSUMER_SETTLED":
      s.settledTxHash = e.txHash;
      setStep(s, 6, "done");
      break;
    case "RUN_FAILED": {
      s.failure = { stage: e.stage, reason: e.reason };
      const active = s.steps.find((st) => st.state === "active");
      if (active) setStep(s, active.id, "failed");
      if (e.stage.startsWith("level3")) s.level3.status = "failed";
      if (e.stage.startsWith("level4")) s.level4.status = "failed";
      break;
    }
  }
  return s;
}

export function replayTo(events: RunEvent[], seq: number): ControlRoomState {
  let s = initialState();
  for (const re of events) {
    if (re.seq > seq) break;
    s = applyEvent(s, re);
  }
  return s;
}

export function finalState(events: RunEvent[]): ControlRoomState {
  return replayTo(events, Number.MAX_SAFE_INTEGER);
}

/** Which lane/section an event belongs to — used by the UI for placement. */
export function laneOf(t: RelayEventType): "shared" | "level3" | "level4" | "base" {
  switch (t) {
    case "LEVEL3_RPC_RESULT":
    case "LEVEL3_BASE_FINALIZED":
      return "level3";
    case "PROOF_STAGED":
    case "SOLANA_VERIFY_SUBMITTED":
    case "TXLINE_CPI_VERIFIED":
    case "WORMHOLE_MESSAGE_PUBLISHED":
    case "VAA_READY":
    case "LEVEL4_BASE_SUBMITTED":
    case "BASE_VAA_VERIFIED":
      return "level4";
    case "DUAL_FINALITY_REACHED":
    case "CONSUMER_SETTLED":
      return "base";
    default:
      return "shared";
  }
}
