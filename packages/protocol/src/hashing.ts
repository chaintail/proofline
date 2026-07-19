/**
 * Canonical hash definitions. Everything is keccak256 so the same digests are
 * cheap to derive on Base; Solana-side code hashes the identical byte strings.
 */
import { keccak256, encodePacked, toBytes, toHex } from "viem";

/**
 * validation_instruction_hash — identifies precisely what the Solana adapter
 * validated: keccak256(txline_program_id_32 || daily_root_pda_32 || instruction_data).
 */
export function validationInstructionHash(
  txlineProgramId32: `0x${string}`,
  dailyRootPda32: `0x${string}`,
  instructionData: Uint8Array,
): `0x${string}` {
  return keccak256(
    encodePacked(
      ["bytes32", "bytes32", "bytes"],
      [txlineProgramId32, dailyRootPda32, toHex(instructionData)],
    ),
  );
}

/**
 * proof_bundle_hash — hash of the complete off-chain evidence bundle
 * (final score record + TxLINE proof + root account + selected statistics +
 * validation strategy), canonicalized as sorted-key JSON.
 */
export function proofBundleHash(bundle: unknown): `0x${string}` {
  return keccak256(toBytes(canonicalJson(bundle)));
}

/** Deterministic JSON: object keys sorted lexicographically, no whitespace. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
}

/** Base58 → 32-byte hex (Solana pubkeys travel as raw 32 bytes in payloads). */
export function base58ToHex32(b58: string): `0x${string}` {
  const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let n = 0n;
  for (const c of b58) {
    const i = ALPHABET.indexOf(c);
    if (i < 0) throw new Error(`invalid base58 char ${c}`);
    n = n * 58n + BigInt(i);
  }
  let hex = n.toString(16).padStart(64, "0");
  // account for leading zeros encoded as '1'
  let leading = 0;
  for (const c of b58) {
    if (c === "1") leading++;
    else break;
  }
  hex = "00".repeat(leading) + hex;
  if (hex.length > 64) throw new Error("value exceeds 32 bytes");
  return `0x${hex.padStart(64, "0")}` as `0x${string}`;
}
