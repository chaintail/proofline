/**
 * Event store — the coordinator is ONLY an observer and event recorder.
 * It never decides whether an outcome is valid; correctness is enforced by
 * the Solana adapter and the Base receivers. It assigns sequence numbers,
 * stamps real wall-clock times, persists NDJSON, and fans out to SSE.
 */
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { RelayEvent, RunEvent, RunManifest } from "@proofline/event-model";
import { validateManifest } from "@proofline/event-model";

export interface ActiveRun {
  runId: string;
  dir: string;
  startedAt: number;
  meta: Omit<RunManifest, "events" | "artifacts" | "attestationId"> & {
    attestationId?: string;
  };
  events: RunEvent[];
}

export class EventStore {
  private run: ActiveRun | null = null;
  private listeners = new Set<(e: RunEvent) => void>();

  constructor(private evidenceRoot: string) {}

  startRun(meta: ActiveRun["meta"]): ActiveRun {
    const dir = join(this.evidenceRoot, meta.runId);
    mkdirSync(dir, { recursive: true });
    this.run = { runId: meta.runId, dir, startedAt: Date.now(), meta, events: [] };
    return this.run;
  }

  get active(): ActiveRun | null {
    return this.run;
  }

  record(event: RelayEvent, simulated: boolean): RunEvent {
    if (!this.run) throw new Error("no active run");
    const re: RunEvent = {
      seq: this.run.events.length,
      at: Date.now(),
      simulated,
      event,
    };
    this.run.events.push(re);
    appendFileSync(join(this.run.dir, "events.ndjson"), JSON.stringify(re) + "\n");
    for (const l of this.listeners) l(re);
    return re;
  }

  subscribe(fn: (e: RunEvent) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  finalize(attestationId: string, artifacts: Record<string, string>): RunManifest {
    if (!this.run) throw new Error("no active run");
    const manifest: RunManifest = {
      ...this.run.meta,
      attestationId,
      events: this.run.events,
      artifacts,
    };
    const errs = validateManifest(manifest);
    if (errs.length) throw new Error(`manifest invalid: ${errs.join("; ")}`);
    writeFileSync(join(this.run.dir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
    return manifest;
  }
}
