import { BUILDINGS, GARAGES, LOTS } from "../data/index.ts";
import { buildingCodes } from "../data/building-abbreviations.ts";
import type { Selection } from "../types.ts";
import { garageStatus, garageTotals, lotStatus, lotSummary } from "../lib/occupancy.ts";
import { filterBuildings, filterByName } from "../lib/search.ts";
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
      <input id="list-q" type="search" placeholder="e.g. Perry, Squires, TORG" autocomplete="off" spellcheck="false" enterkeyhint="search">
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
    // Every university building is listed too (alphabetical), after the garages and lots, so a driver can open a building's sheet and see its
    // nearest parking without typing. Searching filters all three groups. Keyboard and screen-reader users, who cannot reach the map's
    // building shapes, rely on this list (the map's aria-label points here).
    const buildings = q.trim() ? filterBuildings(BUILDINGS, q) : [...BUILDINGS].sort((a, b) => a.name.localeCompare(b.name));
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
    const bRows = buildings.map((b) => {
      const codes = buildingCodes(b.num);
      return row("building", b.id, b.name, `${codes.length ? `<strong>${esc(codes.join(", "))}</strong> &middot; ` : ""}${CATEGORY_LABEL[b.category]} &middot; Building ${esc(b.num)}`, "");
    });
    const groups = [
      { id: "garages", label: "Garages", rows: gRows },
      { id: "lots", label: "Lots", rows: lRows },
      { id: "buildings", label: "Buildings", rows: bRows },
    ].filter((g) => g.rows.length);
    const jump = groups.length > 1 ? `<div class="list-jump" role="group" aria-label="Jump to a section">${groups.map((g) => `<button type="button" data-jump="list-sec-${g.id}">${g.label} ${g.rows.length}</button>`).join("")}</div>` : "";
    results.innerHTML = jump + groups.map((g) => `<h2 class="list-h" id="list-sec-${g.id}">${g.label} <span>${g.rows.length}</span></h2><ul class="rows">${g.rows.join("")}</ul>`).join("");
  }

  input.addEventListener("input", () => {
    render();
    handlers.onQuery(input.value);
  });
  results.addEventListener("click", (e) => {
    const jumpBtn = (e.target as Element).closest<HTMLElement>("button[data-jump]");
    if (jumpBtn) return void document.getElementById(jumpBtn.dataset.jump!)?.scrollIntoView({ block: "start" });
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
