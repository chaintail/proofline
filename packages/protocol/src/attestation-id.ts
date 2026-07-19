/**
 * attestationId — the identity that Level 3 and Level 4 must INDEPENDENTLY
 * derive; digest equality is exactly what powers DUAL FINALIZED.
 *
 * Solidity equivalent (contracts/base/src/libraries/AttestationIds.sol):
 *   keccak256(abi.encodePacked(
 *     DOMAIN_SEPARATOR, sourceEmitter, fixtureId, scoreSequence,
 *     validationInstructionHash, proofBundleHash))
 * with fixtureId/scoreSequence as int64 (8 bytes each, big-endian, two's
 * complement — abi.encodePacked(int64) semantics).
 */
import { keccak256, encodePacked, stringToBytes } from "viem";
import { ATTESTATION_DOMAIN_STRING } from "./constants";

export const DOMAIN_SEPARATOR: `0x${string}` = keccak256(
  stringToBytes(ATTESTATION_DOMAIN_STRING),
);

export function attestationId(params: {
  sourceEmitter: `0x${string}`; // 32-byte Solana emitter (adapter emitter PDA)
  fixtureId: bigint;
  scoreSequence: bigint;
  validationInstructionHash: `0x${string}`;
  proofBundleHash: `0x${string}`;
}): `0x${string}` {
  return keccak256(
    encodePacked(
      ["bytes32", "bytes32", "int64", "int64", "bytes32", "bytes32"],
      [
        DOMAIN_SEPARATOR,
        params.sourceEmitter,
        params.fixtureId,
        params.scoreSequence,
        params.validationInstructionHash,
        params.proofBundleHash,
      ],
    ),
  );
}
