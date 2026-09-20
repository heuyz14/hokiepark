import type { SyncStatus } from "../live.ts";

/**
 * How stale the database counts may get before the header chip warns. The demo simulator runs from pg_cron every
 * 5 minutes (supabase/optional/schedule_simulator.sql), so a healthy feed is never older than ~5 minutes; 12 minutes
 * means "two ticks were missed, plus slack". Keep this in step with that schedule.
 */
export const STALE_DATA_MS = 12 * 60_000;

/** "just now", "42s ago", "7m ago", "4h ago", "2d ago" - never an unreadable "281m ago". */
export function relativeAge(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 10) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
}

export interface SyncLabel {
  text: string;
  title: string;
  tone: "off" | "live" | "warn";
}

/** Pure description of the header chip for a given status and clock (so it can be unit-tested). */
export function describeSync(status: SyncStatus, now: number): SyncLabel {
  if (status.state === "demo") return { text: "Sample data", title: "Showing bundled sample counts (live feed not configured).", tone: "off" };
  if (status.state === "connecting") return { text: "Connecting", title: "Connecting to the occupancy feed.", tone: "off" };
  if (status.state === "offline") {
    return {
      text: "Offline",
      title: status.lastSync ? "Can't reach the feed. Showing the last known counts." : "Can't reach the feed. Showing bundled sample counts.",
      tone: "warn",
    };
  }
  const old = status.dataAsOf !== null && now - status.dataAsOf > STALE_DATA_MS;
  if (old) {
    return {
      text: `Data ${relativeAge(now - status.dataAsOf!)}`,
      title: "Connected, but the counts in the database haven't changed recently (the demo simulator may not be running).",
      tone: "warn",
    };
  }
  return { text: `Live · ${relativeAge(now - (status.lastSync ?? now))}`, title: "Counts synced from the occupancy feed (simulated demo data).", tone: "live" };
}
