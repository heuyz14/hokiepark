import { GARAGES } from "./data/index.ts";
import type { LiveConfig } from "./lib/live-config.ts";
import { applyOccupancy, fetchOccupancy, latestUpdate } from "./lib/occupancy-remote.ts";

export type SyncState = "demo" | "connecting" | "live" | "offline";
export interface SyncStatus {
  state: SyncState;
  /** epoch ms of the last successful fetch */
  lastSync: number | null;
  /** epoch ms of the newest row's updated_at in the database */
  dataAsOf: number | null;
}

const MAX_BACKOFF_MS = 60_000;

/**
 * Poll the occupancy table. Never overlaps requests, backs off on failure, pauses while the tab is hidden,
 * and refetches immediately when the tab becomes visible or the network returns. On any failure the
 * last known counts stay on screen (they are the same GARAGES every view reads).
 */
export function startLive(cfg: LiveConfig, hooks: { onChange: () => void; onStatus: (s: SyncStatus) => void }): void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let inFlight = false;
  let failures = 0;
  let status: SyncStatus = { state: "connecting", lastSync: null, dataAsOf: null };
  const emit = (patch: Partial<SyncStatus>) => {
    status = { ...status, ...patch };
    hooks.onStatus(status);
  };

  const schedule = () => {
    clearTimeout(timer);
    if (document.hidden) return; // resumed by visibilitychange
    const delay = failures ? Math.min(cfg.pollMs * 2 ** failures, MAX_BACKOFF_MS) : cfg.pollMs;
    timer = setTimeout(tick, delay);
  };

  async function tick() {
    if (inFlight) return;
    inFlight = true;
    try {
      const rows = await fetchOccupancy(cfg);
      const changed = applyOccupancy(GARAGES, rows);
      failures = 0;
      emit({ state: "live", lastSync: Date.now(), dataAsOf: latestUpdate(rows) });
      if (changed) hooks.onChange();
    } catch (err) {
      failures++;
      console.info("occupancy sync failed; keeping last known counts:", err instanceof Error ? err.message : err);
      emit({ state: "offline" });
    } finally {
      inFlight = false;
      schedule();
    }
  }

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      clearTimeout(timer);
      void tick();
    }
  });
  addEventListener("online", () => {
    clearTimeout(timer);
    void tick();
  });
  hooks.onStatus(status);
  void tick();
}
