/**
 * The typed event union that drives BOTH live and replay UI — the design's
 * "no fake animation" rule: every rendered transition corresponds to one of
 * these events, produced by a real action (or an explicitly labeled
 * simulation — see RunEvent.simulated).
 */
export type RelayEvent =
  | { type: "HEARTBEAT"; at: number; nextAt: number }
  | { type: "FINAL_RECORD_OBSERVED"; fixtureId: string; sequence: string }
  | { type: "PROOF_AVAILABLE"; proofHash: string; rootPda: string }
  | { type: "PROOF_STAGED"; solanaSignature: string }
  | { type: "SOLANA_VERIFY_SUBMITTED"; signature: string }
  | { type: "TXLINE_CPI_VERIFIED"; slot: number }
  | { type: "WORMHOLE_MESSAGE_PUBLISHED"; emitter: string; sequence: string }
  | { type: "VAA_READY"; vaaHash: string; signatures: number[] }
  | { type: "LEVEL3_RPC_RESULT"; provider: string; agreed: boolean; simulationDigest: string }
  | { type: "LEVEL3_BASE_FINALIZED"; txHash: string }
  | { type: "LEVEL4_BASE_SUBMITTED"; txHash: string }
  | { type: "BASE_VAA_VERIFIED"; blockNumber: number }
  | { type: "DUAL_FINALITY_REACHED"; attestationId: string }
  | { type: "CONSUMER_SETTLED"; txHash: string }
  | { type: "RUN_FAILED"; stage: string; reason: string };

export type RelayEventType = RelayEvent["type"];

/**
 * Envelope recorded in evidence/runs/<id>/manifest.json.
 * `simulated: true` marks legs that did not touch a real network in this
 * build (Solana verification, Wormhole guardian observation) — the UI
 * surfaces this honestly, Match-DNA "synthetic fixture" style.
 */
export interface RunEvent {
  seq: number;
  /** wall-clock ms — real timestamps, never guessed animation delays */
  at: number;
  simulated: boolean;
  event: RelayEvent;
}

/** One-sentence Explain-mode narration per event type. */
export const EXPLAIN: Record<RelayEventType, string> = {
  HEARTBEAT: "The CRE workflow woke up on its schedule and checked for work.",
  FINAL_RECORD_OBSERVED: "TxLINE's feed shows this match is over — a game_finalised record appeared.",
  PROOF_AVAILABLE: "TxLINE committed the score to Solana and the Merkle proof is now downloadable.",
  PROOF_STAGED: "The proof was uploaded into a Solana buffer account, ready for verification.",
  SOLANA_VERIFY_SUBMITTED: "Our Solana program was asked to verify the proof.",
  TXLINE_CPI_VERIFIED: "TxLINE's own on-chain verifier checked the proof and returned TRUE.",
  WORMHOLE_MESSAGE_PUBLISHED: "The verified outcome was published as a Wormhole message.",
  VAA_READY: "Wormhole Guardians signed the message — the attestation (VAA) is ready.",
  LEVEL3_RPC_RESULT: "An independent Solana RPC provider simulated the verification transaction.",
  LEVEL3_BASE_FINALIZED: "The fast-lane attestation landed on Base.",
  LEVEL4_BASE_SUBMITTED: "The signed VAA was submitted to Base.",
  BASE_VAA_VERIFIED: "Base verified the Guardian signatures — native cross-chain finality.",
  DUAL_FINALITY_REACHED: "Fast lane and proof lane produced the same digest. Dual finalized.",
  CONSUMER_SETTLED: "The prediction market read the registry and settled. Payouts unlocked.",
  RUN_FAILED: "This stage failed — see the reason for what stopped the run.",
};

/** Verification-boundary events for the "pause at each verification boundary" toggle. */
export const VERIFICATION_BOUNDARIES: RelayEventType[] = [
  "PROOF_AVAILABLE",
  "TXLINE_CPI_VERIFIED",
  "WORMHOLE_MESSAGE_PUBLISHED",
  "VAA_READY",
  "BASE_VAA_VERIFIED",
  "CONSUMER_SETTLED",
];
