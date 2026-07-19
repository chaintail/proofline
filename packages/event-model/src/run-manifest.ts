/**
 * evidence/runs/<run-id>/manifest.json — the recorded array replay mode
 * consumes. Live mode produced these exact events; replay renders them with
 * their real timestamps.
 */
import type { RunEvent } from "./events";

export interface RunFixture {
  fixtureId: string;
  participant1: string;
  participant2: string;
  participant1Score: number;
  participant2Score: number;
  period: number;
  kickoffIso?: string;
  competition?: string;
  /** true = deterministic packaged fixture, not a live TxLINE feed read */
  synthetic: boolean;
}

export interface RunContracts {
  chainId: number;
  explorerBaseUrl: string;
  finalityRegistry: string;
  creLevel3Receiver: string;
  wormholeOutcomeReceiver: string;
  demoPredictionMarket: string;
  wormholeCore: string;
  /** honest labeling: which core is in play */
  wormholeCoreKind: "mainnet" | "testnet" | "dev-guardian-set-mock";
}

export interface RunManifest {
  runId: string;
  createdAtIso: string;
  description: string;
  fixture: RunFixture;
  contracts: RunContracts;
  attestationId: string;
  /** legs that are simulated in this run (UI badges) */
  simulatedLegs: string[];
  events: RunEvent[];
  artifacts: Record<string, string>; // filename -> description
}

export function validateManifest(m: RunManifest): string[] {
  const errs: string[] = [];
  if (!m.runId) errs.push("runId missing");
  if (!Array.isArray(m.events) || m.events.length === 0) errs.push("events empty");
  let lastSeq = -1;
  let lastAt = -Infinity;
  for (const e of m.events) {
    if (e.seq <= lastSeq) errs.push(`seq not strictly increasing at ${e.seq}`);
    if (e.at < lastAt) errs.push(`timestamps not monotonic at seq ${e.seq}`);
    lastSeq = e.seq;
    lastAt = e.at;
  }
  return errs;
}
