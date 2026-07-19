/**
 * VAA source polling. In production this would poll Wormholescan /
 * guardian RPC endpoints for a signed VAA by (chain, emitter, sequence).
 * In this build the "source" is the dev-guardian signer (file or in-process)
 * — the polling contract is identical, the source is simulated and labeled.
 */
import { readFile } from "node:fs/promises";
import { decodeVaa, type Vaa } from "./vaa-decoder";

export interface VaaSource {
  kind: "wormholescan" | "guardian-rpc" | "dev-guardian-file";
  locator: string; // url or file path
}

export async function fetchVaa(
  source: VaaSource,
  ref: { emitterChainId: number; emitterAddress: `0x${string}`; sequence: bigint },
): Promise<{ bytes: Uint8Array; vaa: Vaa } | null> {
  if (source.kind === "dev-guardian-file") {
    try {
      const raw = await readFile(source.locator);
      const bytes = new Uint8Array(raw);
      const vaa = decodeVaa(bytes);
      if (
        vaa.emitterChainId === ref.emitterChainId &&
        vaa.emitterAddress.toLowerCase() === ref.emitterAddress.toLowerCase() &&
        vaa.sequence === ref.sequence
      )
        return { bytes, vaa };
      return null;
    } catch {
      return null;
    }
  }
  // Real network sources: poll <locator>/v1/signed_vaa/<chain>/<emitter>/<sequence>
  const url = `${source.locator}/v1/signed_vaa/${ref.emitterChainId}/${ref.emitterAddress.slice(2)}/${ref.sequence}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const json = (await res.json()) as { vaaBytes?: string };
  if (!json.vaaBytes) return null;
  const bytes = Uint8Array.from(Buffer.from(json.vaaBytes, "base64"));
  return { bytes, vaa: decodeVaa(bytes) };
}
