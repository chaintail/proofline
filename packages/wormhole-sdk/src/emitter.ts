/** Emitter helpers — the demo emitter matches the registered value on Base. */
import { base58ToHex32 } from "@proofline/protocol";

/** Deterministic 32-byte stand-in for the adapter's Wormhole emitter PDA. */
export const DEMO_EMITTER_BASE58 = "Emitter1111111111111111111111111111111111";
export const DEMO_EMITTER: `0x${string}` = base58ToHex32(DEMO_EMITTER_BASE58);
