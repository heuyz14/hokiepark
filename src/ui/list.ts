import { GARAGES, LOTS } from "../data/index.ts";
import type { Selection } from "../types.ts";
import { garageStatus, garageTotals, lotSummary, STATUS_LABEL } from "../lib/occupancy.ts";
import { filterByName } from "../lib/search.ts";
import { eligibleLevels, eligibleOpen, eligibleStatus, lotAllows, PERMIT_LABEL, type PermitChoice } from "../lib/permits.ts";
import { sameSelection } from "../state.ts";
import { adaBadge } from "./badge.ts";
import { esc, statusPill } from "./format.ts";

export interface ListController {
  setSelected(sel: Selection): void;
  setQuery(q: string): void;
  /** Re-render after a live data update, keeping keyboard focus on the same row. */
  refresh(): void;
  setPermit(permit: PermitChoice | null): void;
}

export function createList(el: HTMLElement, handlers: { onSelect: (sel: Selection) => void; onQuery: (q: string) => void }): ListController {
  el.innerHTML = `
    <div class="list-search">
      <label for="list-q">Search garages &amp; lots</label>
      <input id="list-q" type="search" placeholder="e.g. Perry, Squires, bookstore" autocomplete="off" spellcheck="false" enterkeyhint="search">
    </div>
    <div id="list-results" class="list-results" aria-live="polite"></div>`;
  const searchBox = el.querySelector<HTMLElement>(".list-search")!;
  searchBox.insertAdjacentHTML("beforeend", `<label class="list-filter" id="list-filter" hidden><input type="checkbox" id="only-mine"> <span></span></label>`);
  const filterRow = el.querySelector<HTMLElement>("#list-filter")!;
  const onlyMine = el.querySelector<HTMLInputElement>("#only-mine")!;
  let permit: PermitChoice | null = null;
  const input = el.querySelector<HTMLInputElement>("#list-q")!;
  const results = el.querySelector<HTMLElement>("#list-results")!;
  let selected: Selection = null;

  const row = (kind: "garage" | "lot", id: string, name: string, sub: string, side: string) => {
    const on = sameSelection(selected, { kind, id });
    return `<li><button type="button" class="row${on ? " is-selected" : ""}" data-kind="${kind}" data-id="${id}"${on ? ' aria-current="true"' : ""}>
      <span class="row-main"><strong>${esc(name)}</strong><span class="sub">${sub}</span></span>
      <span class="row-side">${side}</span></button></li>`;
  };

  function render() {
    const q = input.value;
    const hide = !!permit && onlyMine.checked;
    const garages = filterByName(GARAGES, q).filter((g) => !hide || eligibleLevels(g, permit!).length > 0);
    const lots = filterByName(LOTS, q).filter((l) => !hide || lotAllows(l, permit!) || l.hasADA);
    if (!garages.length && !lots.length) {
      results.innerHTML = `<p class="state-msg">No garages or lots match &ldquo;${esc(q.trim())}&rdquo;.<br>Try a shorter name, like &ldquo;perry&rdquo; or &ldquo;squ&rdquo;.</p>`;
      return;
    }
    const gRows = garages.map((g) => {
      const t = garageTotals(g);
      return row("garage", g.id, g.name, `Garage &middot; ${t.open} of ${t.capacity} open${permit ? ` &middot; ${eligibleOpen(g, permit)} for your permit` : ""}`, `${permit ? statusPill(eligibleStatus(g, permit), `${STATUS_LABEL[eligibleStatus(g, permit)]} for you`) : statusPill(garageStatus(g))}${adaBadge({ count: t.adaOpen, muted: t.adaOpen === 0 })}`);
    });
    const lRows = lots.map((l) => row("lot", l.id, l.name, esc(lotSummary(l)) + (permit ? (lotAllows(l, permit) ? " &middot; valid for your permit" : " &middot; not your permit") : ""), l.hasADA ? adaBadge({ label: "ADA" }) : ""));
    results.innerHTML =
      (gRows.length ? `<h2 class="list-h">Garages <span>${gRows.length}</span></h2><ul class="rows">${gRows.join("")}</ul>` : "") +
      (lRows.length ? `<h2 class="list-h">Lots <span>${lRows.length}</span></h2><ul class="rows">${lRows.join("")}</ul>` : "");
  }

  onlyMine.addEventListener("change", render);
  input.addEventListener("input", () => {
    render();
    handlers.onQuery(input.value);
  });
  results.addEventListener("click", (e) => {
    const btn = (e.target as Element).closest<HTMLElement>("button[data-kind]");
    if (btn) handlers.onSelect({ kind: btn.dataset.kind as "garage" | "lot", id: btn.dataset.id! });
  });
  render();

  return {
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
    setPermit(p) {
      permit = p;
      filterRow.hidden = !p;
      if (p) filterRow.querySelector("span")!.textContent = `Only show options for my ${PERMIT_LABEL[p]} permit`;
      else onlyMine.checked = false;
      render();
    },
    setQuery(q) {
      if (input.value !== q) {
        input.value = q;
        render();
      }
    },
  };
}
