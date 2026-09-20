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

/** Compact polling cadence for the header chip. */
export function refreshInterval(ms: number): string {
  const seconds = Math.max(1, Math.round(ms / 1000));
  return seconds < 60 ? `${seconds}s` : `${Math.round(seconds / 60)}m`;
}

/** Pure description of the header chip for a given status and clock (so it can be unit-tested). */
export function describeSync(status: SyncStatus, now: number, pollMs?: number): SyncLabel {
  const cadence = pollMs ? refreshInterval(pollMs) : null;
  if (status.state === "demo") return { text: "Sample data · no refresh", title: "Showing bundled sample counts. Automatic refresh is off because the live feed is not configured.", tone: "off" };
  if (status.state === "connecting") return { text: `Connecting${cadence ? ` · refresh ${cadence}` : ""}`, title: `Connecting to the occupancy feed${cadence ? `; it refreshes every ${cadence}` : ""}.`, tone: "off" };
  if (status.state === "offline") {
    return {
      text: `Offline${cadence ? ` · refresh ${cadence}` : ""}`,
      title: `${status.lastSync ? "Can't reach the feed. Showing the last known counts." : "Can't reach the feed. Showing bundled sample counts."}${cadence ? ` The normal refresh interval is ${cadence}; failed requests may retry more slowly.` : ""}`,
      tone: "warn",
    };
  }
  const old = status.dataAsOf !== null && now - status.dataAsOf > STALE_DATA_MS;
  if (old) {
    return {
      text: `Data ${relativeAge(now - status.dataAsOf!)}${cadence ? ` · refresh ${cadence}` : ""}`,
      title: `Connected, but the counts in the database haven't changed recently (the demo simulator may not be running).${cadence ? ` The feed refreshes every ${cadence}.` : ""}`,
      tone: "warn",
    };
  }
  return { text: `Live · ${relativeAge(now - (status.lastSync ?? now))}${cadence ? ` · refresh ${cadence}` : ""}`, title: `Counts synced from the occupancy feed (simulated demo data).${cadence ? ` The feed refreshes every ${cadence}.` : ""}`, tone: "live" };
}
