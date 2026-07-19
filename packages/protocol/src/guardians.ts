/**
 * DEV GUARDIAN SET — honest simulation of Wormhole's 19-guardian network.
 *
 * Wormhole's real Guardians only observe real Wormhole emissions; this
 * build's Solana leg is simulated, so no mainnet VAA can exist for it.
 * Instead we run the REAL verification math against a dev guardian set:
 * 19 secp256k1 keys derived from public strings (below), 13-of-19 quorum
 * enforced on-chain by the Base receiver via ecrecover — exactly Wormhole's
 * scheme. Anyone can re-derive these keys; that is the point: this is a
 * transparency device, not a secret. The UI and README label this leg
 * "dev guardian set" everywhere.
 */
import { keccak256, stringToBytes } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { GUARDIAN_SET_SIZE } from "./constants";

export function devGuardianPrivateKey(index: number): `0x${string}` {
  if (index < 0 || index >= GUARDIAN_SET_SIZE) throw new Error("guardian index out of range");
  return keccak256(stringToBytes(`proofline.dev.guardian.${index}`));
}

export function devGuardianAddress(index: number): `0x${string}` {
  return privateKeyToAccount(devGuardianPrivateKey(index)).address;
}

export function devGuardianAddresses(): `0x${string}`[] {
  return Array.from({ length: GUARDIAN_SET_SIZE }, (_, i) => devGuardianAddress(i));
}
