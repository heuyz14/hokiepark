import { BUILDINGS, GARAGES, LOTS } from "../data/index.ts";
import type { Garage, GarageLevel, Lot, Selection } from "../types.ts";
import { availability, garageStatus, garageTotals, levelStatus, openAdaSpaces, openSpaces } from "../lib/occupancy.ts";
import { nearest, walkMinutes } from "../lib/nearby.ts";
import { adaBadge } from "./badge.ts";
import { CATEGORY_LABEL, esc, meters, statusPill } from "./format.ts";

export interface SheetController {
  render(sel: Selection): void;
}

const head = (title: string, sub: string, right = "") => `
  <div class="sheet-grip" aria-hidden="true"></div>
  <div class="sheet-head">
    <div>
      <h2 id="sheet-title" tabindex="-1">${esc(title)}</h2>
      <p class="sub">${sub}</p>
    </div>
    <button type="button" class="sheet-close" data-close aria-label="Close details">&times;</button>
  </div>${right}`;

function levelRow(l: GarageLevel): string {
  const open = openSpaces(l);
  const st = levelStatus(l);
  const pct = l.capacity ? Math.round((l.occupied / l.capacity) * 100) : 100;
  return `<li class="level level-${st}">
    <div class="level-top">
      <span class="level-label">${esc(l.label)}</span>
      ${adaBadge({ count: openAdaSpaces(l), muted: openAdaSpaces(l) === 0 })}
    </div>
    <div class="level-bar" role="img" aria-label="${pct}% full"><span style="width:${pct}%"></span></div>
    <div class="level-bottom">
      <span><strong>${open}</strong> open of ${l.capacity}</span>
      ${statusPill(st)}
    </div>
  </li>`;
}

function garageBody(g: Garage): string {
  const t = garageTotals(g);
  const st = garageStatus(g);
  return (
    head(g.name, `Parking garage &middot; ${g.levels.length} levels`) +
    `<div class="sheet-body">
      <div class="summary">
        <div><span class="big">${t.open}</span><span class="of"> / ${t.capacity} open</span></div>
        ${statusPill(st)}
        ${adaBadge({ count: t.adaOpen, label: "accessible open", muted: t.adaOpen === 0 })}
      </div>
      <h3>By level</h3>
      <ul class="levels">${g.levels.map(levelRow).join("")}</ul>
      <p class="fine">Demo data &mdash; counts are simulated, not from live sensors.</p>
    </div>`
  );
}

function lotBody(l: Lot): string {
  const ada = l.hasADA
    ? `<div class="ada-note">${adaBadge({ label: "Accessible parking available" })}<p>${l.adaSpaces} designated accessible spaces (illustrative count).</p></div>`
    : `<p class="no-ada">No designated accessible spaces flagged in this lot.</p>`;
  return (
    head(l.name, `Parking lot${l.number ? ` ${l.number}` : ""}`) +
    `<div class="sheet-body">
      <dl class="facts">
        <div><dt>Permit</dt><dd>${esc(l.permit)}</dd></div>
        <div><dt>Status</dt><dd>${esc(l.status)}</dd></div>
      </dl>
      ${ada}
      <p class="fine">Live space counts aren't tracked for lots in this demo.</p>
    </div>`
  );
}

function buildingBody(id: string): string {
  const b = BUILDINGS.find((x) => x.id === id);
  if (!b) return "";
  const near = nearest([...GARAGES.map((g) => ({ ...g, kind: "garage" as const })), ...LOTS.map((l) => ({ ...l, kind: "lot" as const }))], b, 3);
  const rows = near
    .map(({ item, meters: m }) => {
      const extra =
        item.kind === "garage"
          ? (() => {
              const t = garageTotals(item);
              return `${statusPill(availability(t.open, t.capacity), t.open ? `${t.open} open` : "Full")}${adaBadge({ count: t.adaOpen, muted: t.adaOpen === 0 })}`;
            })()
          : item.hasADA
            ? adaBadge({ label: "ADA" })
            : "";
      return `<li><button type="button" data-select-kind="${item.kind}" data-select-id="${item.id}">
        <span class="row-main"><strong>${esc(item.name)}</strong><span class="sub">${item.kind === "garage" ? "Garage" : "Lot"} &middot; ${meters(m)} &middot; ${walkMinutes(m)} min walk</span></span>
        <span class="row-side">${extra}</span></button></li>`;
    })
    .join("");
  return (
    head(b.name, `${CATEGORY_LABEL[b.category]} &middot; Building ${esc(b.num)}`) +
    `<div class="sheet-body"><h3>Nearest parking</h3><ul class="rows">${rows}</ul>
     <p class="fine">Straight-line distance; walking time estimated at 80 m/min.</p></div>`
  );
}

export function createSheet(el: HTMLElement, handlers: { onClose: () => void; onSelect: (sel: Selection) => void }): SheetController {
  el.addEventListener("click", (e) => {
    const t = e.target as Element;
    if (t.closest("[data-close]")) return handlers.onClose();
    const pick = t.closest<HTMLElement>("[data-select-kind]");
    if (pick) handlers.onSelect({ kind: pick.dataset.selectKind as "garage" | "lot", id: pick.dataset.selectId! });
  });
  el.addEventListener("keydown", (e) => {
    if (e.key === "Escape") handlers.onClose();
  });

  return {
    render(sel) {
      if (!sel) {
        el.hidden = true;
        el.innerHTML = "";
        return;
      }
      let html = "";
      if (sel.kind === "garage") {
        const g = GARAGES.find((x) => x.id === sel.id);
        if (g) html = garageBody(g);
      } else if (sel.kind === "lot") {
        const l = LOTS.find((x) => x.id === sel.id);
        if (l) html = lotBody(l);
      } else html = buildingBody(sel.id);
      if (!html) {
        el.hidden = true;
        return;
      }
      el.innerHTML = html;
      el.scrollTop = 0;
      el.hidden = false;
    },
  };
}
