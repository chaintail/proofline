/** "View transaction trace" payload for the evidence drawer. */
export interface TransactionTrace {
  signature: string;
  slot: number;
  programIds: string[];
  instructionDiscriminators: string[];
  inputHash: string;
  txlineReturnValue: boolean | null;
  explorerUrl: string | null; // null for simulated txs — the UI shows "simulated leg" instead
  rawLogs: string[];
  simulated: boolean;
}
