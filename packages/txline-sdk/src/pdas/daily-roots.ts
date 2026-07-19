/**
 * Daily-root PDA namespace helpers. The "daily" name is an indexing
 * namespace, not a one-day delay: score/odds batches close on UTC-aligned
 * five-minute intervals; the daily PDA is the container for that UTC day.
 */
export const SCORES_NAMESPACE = "daily_scores_roots";
export const ODDS_NAMESPACE = "daily_batch_roots";
export const FIXTURES_NAMESPACE = "ten_daily_fixtures_roots";

export const BATCH_INTERVAL_MS = 5 * 60 * 1000;

/** Which UTC epoch-day PDA a proof timestamp belongs to. */
export function epochDay(timestampMs: number): number {
  return Math.floor(timestampMs / 86_400_000);
}

/** Which five-minute batch inside that day the timestamp falls in. */
export function batchIndex(timestampMs: number): number {
  return Math.floor((timestampMs % 86_400_000) / BATCH_INTERVAL_MS);
}

/** Expected proof-availability window after a final record: ~0–5 minutes. */
export function batchCloseMs(timestampMs: number): number {
  return (Math.floor(timestampMs / BATCH_INTERVAL_MS) + 1) * BATCH_INTERVAL_MS;
}
