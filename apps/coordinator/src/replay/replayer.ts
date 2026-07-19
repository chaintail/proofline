/** Replay a recorded manifest through the same reducer live mode uses. */
import { readFileSync } from "node:fs";
import type { RunManifest } from "@proofline/event-model";
import { finalState, replayTo } from "@proofline/event-model";

export function loadManifest(path: string): RunManifest {
  return JSON.parse(readFileSync(path, "utf8")) as RunManifest;
}

export function stateAt(manifest: RunManifest, seq: number) {
  return replayTo(manifest.events, seq);
}

export function terminalState(manifest: RunManifest) {
  return finalState(manifest.events);
}
