/**
 * Dev-guardian VAA signing. 13-of-19 quorum, real secp256k1 signatures over
 * the real Wormhole digest — verified on Base by ecrecover. The dev guardian
 * set is derived from public strings (see @proofline/protocol guardians.ts);
 * this simulates Wormhole's GUARDIAN OBSERVATION step, not its cryptography.
 */
import { sign } from "viem/accounts";
import { devGuardianPrivateKey, GUARDIAN_QUORUM } from "@proofline/protocol";
import { vaaSigningDigest, type Vaa, type VaaBody, type VaaSignature } from "./vaa-decoder";

export async function signVaaWithDevGuardians(
  body: VaaBody,
  guardianIndices?: number[],
): Promise<Vaa> {
  const indices = guardianIndices ?? defaultQuorumIndices();
  const digest = vaaSigningDigest(body);
  const signatures: VaaSignature[] = [];
  for (const gi of [...indices].sort((a, b) => a - b)) {
    const sig = await sign({ hash: digest, privateKey: devGuardianPrivateKey(gi) });
    signatures.push({
      guardianIndex: gi,
      r: sig.r,
      s: sig.s,
      v: Number(sig.v ?? 27n) - 27,
    });
  }
  return { version: 1, guardianSetIndex: 0, signatures, ...body };
}

/** A stable, non-contiguous 13-of-19 subset — looks like a real quorum, is deterministic. */
export function defaultQuorumIndices(): number[] {
  return [0, 1, 2, 4, 5, 7, 8, 10, 11, 13, 15, 16, 18].slice(0, GUARDIAN_QUORUM);
}
