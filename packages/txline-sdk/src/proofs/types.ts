/**
 * TxLINE proof hierarchy (scores): statistic → score-event root → fixture
 * summary root → main batch root committed on Solana.
 */
export interface MerkleNode {
  hash: string;
  position: "left" | "right";
}

export interface ScoreProof {
  fixtureId: string;
  sequence: string;
  leaf: { statistic: string; value: number };
  path: MerkleNode[];
  scoreEventRoot: string;
  fixtureSummaryRoot: string;
  batchRoot: string;
  rootAccount: string; // base58 daily root PDA
  timestampMs: number;
}

/**
 * What a verified proof DOES establish: this exact value was included in the
 * dataset TxODDS committed to Solana. What it does NOT establish: that the
 * value is unquestionably what happened in the physical match — TxODDS
 * remains the originating oracle. Tamper-evident, not "trustless truth."
 */
export const TRUST_STATEMENT =
  "Merkle-proven against TxLINE's Solana commitment; TxODDS remains the originating oracle.";
