import { BUILDINGS, GARAGES, LOTS } from "../data/index.ts";
import type { Selection } from "../types.ts";
import { garageStatus, garageTotals, lotStatus, lotSummary } from "../lib/occupancy.ts";
import { filterByName } from "../lib/search.ts";
import { sameSelection } from "../state.ts";
import { adaBadge } from "./badge.ts";
import { CATEGORY_LABEL, esc, statusPill } from "./format.ts";
import { garageAccess, lotAccess, type PermitId, type Verdict } from "../lib/permits.ts";

export interface ListController {
  setSelected(sel: Selection): void;
  setQuery(q: string): void;
  /** Re-render after a live data update, keeping keyboard focus on the same row. */
  refresh(): void;
  setPermits(permits: PermitId[], ada: boolean): void;
}

export function createList(el: HTMLElement, handlers: { onSelect: (sel: Selection) => void; onQuery: (q: string) => void }): ListController {
  el.innerHTML = `
    <div class="list-search">
      <label for="list-q">Search garages, lots &amp; buildings</label>
      <input id="list-q" type="search" placeholder="e.g. Perry, Squires, bookstore" autocomplete="off" spellcheck="false" enterkeyhint="search">
    </div>
    <div id="list-results" class="list-results" aria-live="polite"></div>`;
  const input = el.querySelector<HTMLInputElement>("#list-q")!;
  const results = el.querySelector<HTMLElement>("#list-results")!;
  let selected: Selection = null;
  let held: PermitId[] = [];
  let heldAda = false;
  const filtering = () => held.length > 0 || heldAda;

  /** A short, screen-reader-friendly tag on rows the driver's permits don't fully cover. */
  const accTag = (v: Verdict) =>
    v === "yes" ? "" : `<span class="acc-tag acc-${v}">${v === "no" ? "Permit not valid" : "Check sign"}</span>`;

  const row = (kind: "garage" | "lot" | "building", id: string, name: string, sub: string, side: string, verdict?: Verdict) => {
    const on = sameSelection(selected, { kind, id });
    const acc = verdict && filtering() ? ` acc-${verdict}` : "";
    return `<li><button type="button" class="row${on ? " is-selected" : ""}${acc}" data-kind="${kind}" data-id="${id}"${on ? ' aria-current="true"' : ""}>
      <span class="row-main"><strong>${esc(name)}</strong><span class="sub">${sub}</span></span>
      <span class="row-side">${side}</span></button></li>`;
  };

  function render() {
    const q = input.value;
    const garages = filterByName(GARAGES, q);
    const lots = filterByName(LOTS, q);
    // Buildings only surface once the user searches: this keeps the default browse list
    // exactly "every garage and lot" (spec Section 6), while still giving keyboard and
    // screen-reader users - who can't reach the map's SVG building shapes - a way to open
    // a building's sheet and see its nearest parking (the map's aria-label points here).
    const buildings = q.trim() ? filterByName(BUILDINGS, q) : [];
    if (!garages.length && !lots.length && !buildings.length) {
      results.innerHTML = `<p class="state-msg">No garages, lots, or buildings match &ldquo;${esc(q.trim())}&rdquo;.<br>Try a shorter name, like &ldquo;perry&rdquo; or &ldquo;squ&rdquo;.</p>`;
      return;
    }
    const gRows = garages.map((g) => {
      const t = garageTotals(g);
      const v = garageAccess(g.levels, held, { ada: heldAda }).verdict;
      return row("garage", g.id, g.name, `Garage &middot; ${t.open} of ${t.capacity} open`, `${filtering() ? accTag(v) : ""}${statusPill(garageStatus(g))}${adaBadge({ count: t.adaOpen, muted: t.adaOpen === 0 })}`, v);
    });
    const lRows = lots.map((l) => {
      const v = lotAccess(l, held, { ada: heldAda }).verdict;
      return row("lot", l.id, l.name, lotSummary(l), `${filtering() ? accTag(v) : ""}${statusPill(lotStatus(l))}${l.hasADA ? adaBadge({ label: "ADA" }) : ""}`, v);
    });
    const bRows = buildings.map((b) => row("building", b.id, b.name, `${CATEGORY_LABEL[b.category]} &middot; Building ${esc(b.num)}`, ""));
    results.innerHTML =
      (gRows.length ? `<h2 class="list-h">Garages <span>${gRows.length}</span></h2><ul class="rows">${gRows.join("")}</ul>` : "") +
      (lRows.length ? `<h2 class="list-h">Lots <span>${lRows.length}</span></h2><ul class="rows">${lRows.join("")}</ul>` : "") +
      (bRows.length ? `<h2 class="list-h">Buildings <span>${bRows.length}</span></h2><ul class="rows">${bRows.join("")}</ul>` : "");
  }

  input.addEventListener("input", () => {
    render();
    handlers.onQuery(input.value);
  });
  results.addEventListener("click", (e) => {
    const btn = (e.target as Element).closest<HTMLElement>("button[data-kind]");
    if (btn) handlers.onSelect({ kind: btn.dataset.kind as "garage" | "lot" | "building", id: btn.dataset.id! });
  });
  render();

  return {
    setPermits(permits, ada) {
      held = permits;
      heldAda = ada;
      render();
    },
    setSelected(sel) {
      selected = sel;
      render();
      results.querySelector(".is-selected")?.scrollIntoView({ block: "nearest" });
    },
    refresh() {
      const focusedId = (document.activeElement as HTMLElement | null)?.closest?.("#list-results button[data-id]")?.getAttribute("data-id");
      render();
      if (focusedId) results.querySelector<HTMLElement>(`button[data-id="${focusedId}"]`)?.focus({ preventScroll: true });
    },
    setQuery(q) {
      if (input.value !== q) {
        input.value = q;
        render();
      }
    },
  };
}
