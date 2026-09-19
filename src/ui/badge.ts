import { esc } from "./format.ts";

/**
 * THE wheelchair badge (Phase 3, step 1). One component, three call sites: garage level rows,
 * flagged lot sheets, and the map legend. Uses the ADA blue token, never the residential blue.
 */
export function adaBadge(opts: { count?: number | string; label?: string; muted?: boolean } = {}): string {
  const { count, label, muted } = opts;
  const text = [count !== undefined ? String(count) : "", label ?? ""].filter(Boolean).join(" ");
  const aria = label ?? (count !== undefined ? `${count} accessible spaces open` : "Accessible parking");
  return `<span class="ada${muted ? " ada-zero" : ""}" role="img" aria-label="${esc(aria)}"><svg width="16" height="16" aria-hidden="true"><use href="#i-wheelchair"/></svg>${text ? `<span>${esc(text)}</span>` : ""}</span>`;
}
