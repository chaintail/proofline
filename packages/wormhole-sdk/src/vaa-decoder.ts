/**
 * Wormhole VAA v1 wire format — encoder + decoder.
 *
 *   header: version u8 (=1) | guardianSetIndex u32 BE | numSignatures u8
 *           then per signature: guardianIndex u8 | r 32 | s 32 | v u8 (recovery id)
 *   body:   timestamp u32 BE | nonce u32 BE | emitterChainId u16 BE |
 *           emitterAddress 32 | sequence u64 BE | consistencyLevel u8 | payload…
 *
 *   signing digest = keccak256(keccak256(body)) — raw digest, no EIP-191 prefix.
 *
 * This is the real Wormhole layout; the Base-side MockWormholeCore verifies
 * exactly these bytes with ecrecover against the registered guardian set.
 */
import { keccak256 } from "viem";
import { bytesToHex } from "@proofline/protocol";

export interface VaaSignature {
  guardianIndex: number;
  r: `0x${string}`;
  s: `0x${string}`;
  /** recovery id 0|1 (Wormhole stores v-27) */
  v: number;
}

export interface VaaBody {
  timestamp: number;
  nonce: number;
  emitterChainId: number;
  emitterAddress: `0x${string}`; // 32 bytes
  sequence: bigint;
  consistencyLevel: number;
  payload: Uint8Array;
}

export interface Vaa extends VaaBody {
  version: number;
  guardianSetIndex: number;
  signatures: VaaSignature[];
}

function hexToBytes(hex: `0x${string}`): Uint8Array {
  const clean = hex.slice(2);
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function encodeVaaBody(body: VaaBody): Uint8Array {
  const out = new Uint8Array(4 + 4 + 2 + 32 + 8 + 1 + body.payload.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, body.timestamp, false);
  dv.setUint32(4, body.nonce, false);
  dv.setUint16(8, body.emitterChainId, false);
  out.set(hexToBytes(body.emitterAddress), 10);
  dv.setBigUint64(42, body.sequence, false);
  dv.setUint8(50, body.consistencyLevel);
  out.set(body.payload, 51);
  return out;
}

/** The digest guardians sign: keccak256(keccak256(body)). */
export function vaaSigningDigest(body: VaaBody): `0x${string}` {
  return keccak256(hexToBytes(keccak256(encodeVaaBody(body))));
}

export function encodeVaa(vaa: Vaa): Uint8Array {
  const body = encodeVaaBody(vaa);
  const out = new Uint8Array(1 + 4 + 1 + vaa.signatures.length * 66 + body.length);
  const dv = new DataView(out.buffer);
  dv.setUint8(0, vaa.version);
  dv.setUint32(1, vaa.guardianSetIndex, false);
  dv.setUint8(5, vaa.signatures.length);
  let off = 6;
  for (const sig of vaa.signatures) {
    dv.setUint8(off, sig.guardianIndex);
    out.set(hexToBytes(sig.r), off + 1);
    out.set(hexToBytes(sig.s), off + 33);
    dv.setUint8(off + 65, sig.v);
    off += 66;
  }
  out.set(body, off);
  return out;
}

export class VaaDecodeError extends Error {}

export function decodeVaa(bytes: Uint8Array): Vaa {
  if (bytes.length < 6) throw new VaaDecodeError("too short");
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = dv.getUint8(0);
  if (version !== 1) throw new VaaDecodeError("unsupported VAA version");
  const guardianSetIndex = dv.getUint32(1, false);
  const numSigs = dv.getUint8(5);
  let off = 6;
  if (bytes.length < off + numSigs * 66 + 51) throw new VaaDecodeError("truncated");
  const signatures: VaaSignature[] = [];
  for (let i = 0; i < numSigs; i++) {
    signatures.push({
      guardianIndex: dv.getUint8(off),
      r: bytesToHex(bytes.slice(off + 1, off + 33)),
      s: bytesToHex(bytes.slice(off + 33, off + 65)),
      v: dv.getUint8(off + 65),
    });
    off += 66;
  }
  const timestamp = dv.getUint32(off, false);
  const nonce = dv.getUint32(off + 4, false);
  const emitterChainId = dv.getUint16(off + 8, false);
  const emitterAddress = bytesToHex(bytes.slice(off + 10, off + 42));
  const sequence = dv.getBigUint64(off + 42, false);
  const consistencyLevel = dv.getUint8(off + 50);
  const payload = bytes.slice(off + 51);
  return {
    version,
    guardianSetIndex,
    signatures,
    timestamp,
    nonce,
    emitterChainId,
    emitterAddress,
    sequence,
    consistencyLevel,
    payload,
  };
}

/** keccak digest of the full encoded VAA — replay-protection key on Base. */
export function vaaHash(encoded: Uint8Array): `0x${string}` {
  return keccak256(encoded as any);
}
