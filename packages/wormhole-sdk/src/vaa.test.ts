import assert from "node:assert/strict";
import { recoverAddress } from "viem";
import { devGuardianAddress } from "@proofline/protocol";
import {
  decodeVaa,
  encodeVaa,
  encodeVaaBody,
  vaaSigningDigest,
  type VaaBody,
} from "./vaa-decoder";
import { defaultQuorumIndices, signVaaWithDevGuardians } from "./signatures";

const body: VaaBody = {
  timestamp: 1784498160,
  nonce: 7,
  emitterChainId: 1,
  emitterAddress: `0x${"ab".repeat(32)}`,
  sequence: 184n,
  consistencyLevel: 1,
  payload: new TextEncoder().encode("PRFL-test"),
};

// body encode length
assert.equal(encodeVaaBody(body).length, 51 + 9);

// sign + roundtrip
const vaa = await signVaaWithDevGuardians(body);
assert.equal(vaa.signatures.length, 13);
const encoded = encodeVaa(vaa);
const decoded = decodeVaa(encoded);
assert.equal(decoded.sequence, 184n);
assert.equal(decoded.emitterChainId, 1);
assert.equal(decoded.signatures.length, 13);
assert.deepEqual([...decoded.payload], [...body.payload]);

// every signature recovers to the right dev guardian address
const digest = vaaSigningDigest(body);
for (const sig of decoded.signatures) {
  const addr = await recoverAddress({
    hash: digest,
    signature: { r: sig.r, s: sig.s, v: BigInt(sig.v + 27) },
  });
  assert.equal(addr, devGuardianAddress(sig.guardianIndex));
}

// guardian indices strictly ascending (contract requirement)
const idx = decoded.signatures.map((s) => s.guardianIndex);
assert.deepEqual(idx, [...idx].sort((a, b) => a - b));
assert.equal(new Set(idx).size, idx.length);
assert.deepEqual(idx, defaultQuorumIndices());

// tamper: flip a payload byte → digest changes
const tamperedBody = { ...body, payload: new TextEncoder().encode("PRFL-tesT") };
assert.notEqual(vaaSigningDigest(tamperedBody), digest);

console.log("wormhole-sdk: all tests passed");
