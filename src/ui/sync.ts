import type { SyncStatus } from "../live.ts";
import { describeSync } from "../lib/sync-label.ts";

/** Header chip: which data you are looking at (sample / connecting / live / offline). */
export function createSyncChip(el: HTMLElement, initial: SyncStatus, pollMs?: number) {
  let status = initial;
  const render = () => {
    const { text, title, tone } = describeSync(status, Date.now(), pollMs);
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
