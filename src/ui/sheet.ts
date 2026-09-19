import { BUILDINGS, GARAGES, LOTS } from "../data/index.ts";
import { GARAGE_NOTE } from "../data/garages.ts";
import type { Garage, GarageLevel, Lot, PracticalInfo, Selection } from "../types.ts";
import { availability, garageStatus, garageTotals, levelStatus, lotStatus, openAdaSpaces, openSpaces } from "../lib/occupancy.ts";
import { nearest, walkMinutes } from "../lib/nearby.ts";
import { classSummary, garageAccess, lotAccess, SIGNAGE_NOTE, VERDICT_LABEL, type Eligibility, type PermitId } from "../lib/permits.ts";
import { adaBadge } from "./badge.ts";
import { CATEGORY_LABEL, esc, meters, statusPill } from "./format.ts";

export interface SheetController {
  render(sel: Selection, opts?: { preserveScroll?: boolean }): void;
  setPermits(permits: PermitId[], ada: boolean): void;
}

/** Permits the driver holds; kept at module scope so every body function can judge without threading it. */
let held: PermitId[] = [];
let heldAda = false;

/** The verdict banner. Nothing else in the sheet outranks it, so it renders first in the body. */
function verdictBanner(e: Eligibility): string {
  return `<div class="verdict verdict-${e.verdict}">
    <p class="verdict-head">${esc(VERDICT_LABEL[e.verdict])}</p>
    ${e.note ? `<p class="verdict-note">${esc(e.note)}</p>` : ""}
    <p class="verdict-fine">${esc(SIGNAGE_NOTE)}</p>
  </div>`;
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

function levelRow(l: GarageLevel, showAcc = true): string {
  const open = openSpaces(l);
  const st = levelStatus(l);
  const pct = l.capacity ? Math.round((l.occupied / l.capacity) * 100) : 100;
  const acc = showAcc && (held.length || heldAda) ? lotAccess({ classes: l.classes }, held, { ada: heldAda }) : null;
  return `<li class="level level-${st}${acc ? ` acc-${acc.verdict}` : ""}">
    <div class="level-top">
      <span class="level-label">${esc(l.label)}</span>
      ${adaBadge({ count: openAdaSpaces(l), muted: openAdaSpaces(l) === 0 })}
    </div>
    ${acc && acc.verdict !== "yes" ? `<p class="level-acc">${esc(acc.verdict === "no" ? "Not valid for your permit" : "Check the sign")}</p>` : ""}
    <div class="level-bar" role="img" aria-label="${pct}% full"><span style="width:${pct}%"></span></div>
    <div class="level-bottom">
      <span><strong>${open}</strong> open of ${l.capacity}</span>
      ${statusPill(st)}
    </div>
  </li>`;
}

/** Real facts sourced from VT's own parking pages (see PracticalInfo). Absent on most lots. */
function infoSection(info: PracticalInfo | undefined): string {
  if (!info) return "";
  return `<h3>Good to know</h3>
    <dl class="facts-stack">
      <div><dt>Permit rules</dt><dd>${esc(info.permitDetail)}</dd></div>
      <div><dt>Overnight</dt><dd>${esc(info.overnightParking)}</dd></div>
      <div><dt>Payment</dt><dd>${esc(info.payment)}</dd></div>
      <div><dt>Enforcement</dt><dd>${esc(info.enforcement)}</dd></div>
      <div><dt>Location</dt><dd>${esc(info.location)}</dd></div>
      ${info.eventNote ? `<div><dt>Events</dt><dd>${esc(info.eventNote)}</dd></div>` : ""}
    </dl>
    <p class="fine">Source: ${esc(info.source)}.</p>`;
}

function garageBody(g: Garage): string {
  const t = garageTotals(g);
  const st = garageStatus(g);
  const filtering = held.length > 0 || heldAda;
  const acc = filtering ? garageAccess(g.levels, held, { ada: heldAda }) : null;
  // Per-level marks only earn their space when the levels actually disagree.
  const verdicts = new Set(g.levels.map((l) => lotAccess({ classes: l.classes }, held, { ada: heldAda }).verdict));
  const perLevel = filtering && verdicts.size > 1;
  // The standing garage note is redundant once the banner has said the same thing.
  const note = GARAGE_NOTE[g.id];
  const showNote = note && !(acc?.note && acc.note.slice(0, 40) === note.slice(0, 40)) && !(acc?.verdict === "no" && /Perry Street permit/.test(acc.note ?? ""));
  return (
    head(g.name, `Parking garage &middot; ${g.levels.length} levels`) +
    `<div class="sheet-body">
      ${acc ? verdictBanner(acc) : ""}
      ${showNote ? `<p class="fine permit-fine">${esc(note!)}</p>` : ""}
      <div class="summary">
        <div><span class="big">${t.open}</span><span class="of"> / ${t.capacity} open</span></div>
        ${statusPill(st)}
        ${adaBadge({ count: t.adaOpen, label: "accessible open", muted: t.adaOpen === 0 })}
      </div>
      <h3>By level</h3>
      <ul class="levels">${g.levels.map((l) => levelRow(l, perLevel)).join("")}</ul>
      ${infoSection(g.info)}
      <p class="fine">Demo data &mdash; level counts are simulated, not from live sensors. Total capacity is VT's official published figure.</p>
    </div>`
  );
}

function lotBody(l: Lot): string {
  const open = openSpaces(l);
  const st = lotStatus(l);
  const ada = l.hasADA
    ? `<div class="ada-note">${adaBadge({ label: "Accessible parking available" })}<p>${l.adaSpaces} designated accessible spaces (illustrative count).</p></div>`
    : `<p class="no-ada">No designated accessible spaces flagged in this lot.</p>`;
  return (
    head(l.name, `Parking lot${l.number ? ` ${l.number}` : ""}`) +
    `<div class="sheet-body">
      ${held.length || heldAda ? verdictBanner(lotAccess(l, held, { ada: heldAda })) : ""}
      <div class="summary">
        <div><span class="big">${open}</span><span class="of"> / ${l.capacity} open</span></div>
        ${statusPill(st)}
      </div>
      <dl class="facts">
        <div><dt>Permit</dt><dd>${esc(classSummary(l.classes))}</dd></div>
        <div><dt>Status</dt><dd>${esc(l.status)}</dd></div>
      </dl>
      ${ada}
      ${infoSection(l.info)}
      <p class="fine">Demo data &mdash; space counts are simulated, not from live sensors.</p>
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
    setPermits(permits, ada) {
      held = permits;
      heldAda = ada;
    },
    render(sel, opts) {
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
      const top = el.scrollTop;
      el.innerHTML = html;
      el.scrollTop = opts?.preserveScroll ? top : 0;
      el.hidden = false;
    },
  };
}
