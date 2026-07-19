/**
 * Base receipt watcher — cross-checks that every recorded event carrying a
 * Base tx hash corresponds to a real, successful transaction. Used by
 * relay-cli's verify-evidence; the coordinator itself stays a pure recorder.
 */
import type { RunManifest } from "@proofline/event-model";

export interface ReceiptCheck {
  seq: number;
  eventType: string;
  txHash: string;
  found: boolean;
  status?: "success" | "reverted";
  blockNumber?: string;
}

export async function checkBaseReceipts(
  manifest: RunManifest,
  rpcUrl: string,
): Promise<ReceiptCheck[]> {
  const out: ReceiptCheck[] = [];
  for (const re of manifest.events) {
    const e = re.event as { type: string; txHash?: string };
    if (!e.txHash || re.simulated) continue;
    const res = await fetch(rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "eth_getTransactionReceipt",
        params: [e.txHash],
      }),
    });
    const { result } = (await res.json()) as {
      result: { status: string; blockNumber: string } | null;
    };
    out.push({
      seq: re.seq,
      eventType: e.type,
      txHash: e.txHash,
      found: !!result,
      status: result ? (result.status === "0x1" ? "success" : "reverted") : undefined,
      blockNumber: result?.blockNumber,
    });
  }
  return out;
}
