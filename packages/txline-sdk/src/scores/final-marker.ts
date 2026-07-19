/**
 * Final-settlement detection: one marker handles regulation, extra time,
 * penalties, and abandonment through a single settlement path.
 */
import { FINAL_MARKER } from "@proofline/protocol";

export interface ScoreRecord {
  action: string;
  statusId: number;
  period: number;
  fixtureId: string;
  sequence: string;
  participant1Score: number;
  participant2Score: number;
  timestampMs: number;
}

export function isFinalRecord(r: ScoreRecord): boolean {
  return (
    r.action === FINAL_MARKER.action &&
    r.statusId === FINAL_MARKER.statusId &&
    r.period === FINAL_MARKER.period
  );
}
