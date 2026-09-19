import type { SyncStatus } from "../live.ts";

const rel = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 10 ? "just now" : s < 60 ? `${s}s ago` : `${Math.round(s / 60)}m ago`;
};
const STALE_DATA_MS = 5 * 60_000;

/** Header chip: which data you are looking at (sample / connecting / live / offline). */
export function createSyncChip(el: HTMLElement, initial: SyncStatus) {
  let status = initial;
  const render = () => {
    const now = Date.now();
    let text: string;
    let title: string;
    let tone: "off" | "live" | "warn";
    if (status.state === "demo") [text, title, tone] = ["Sample data", "Showing bundled sample counts (live feed not configured).", "off"];
    else if (status.state === "connecting") [text, title, tone] = ["Connecting", "Connecting to the occupancy feed.", "off"];
    else if (status.state === "offline") {
      [text, title, tone] = status.lastSync
        ? ["Offline", "Can't reach the feed. Showing the last known counts.", "warn"]
        : ["Offline", "Can't reach the feed. Showing bundled sample counts.", "warn"];
    } else {
      const old = status.dataAsOf !== null && now - status.dataAsOf > STALE_DATA_MS;
      text = old ? `Data ${rel(now - status.dataAsOf!)}` : `Live · ${rel(now - (status.lastSync ?? now))}`;
      title = old ? "Connected, but the counts in the database haven't changed recently." : "Counts synced from the occupancy feed (simulated demo data).";
      tone = old ? "warn" : "live";
    }
    el.className = `sync sync-${tone}`;
    el.textContent = text;
    el.title = title;
    el.setAttribute("aria-label", `${text}. ${title}`);
  };
  render();
  setInterval(render, 5000);
  return {
    update(next: SyncStatus) {
      status = next;
      render();
    },
  };
}
