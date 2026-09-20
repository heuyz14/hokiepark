import { BUILDINGS } from "../data/index.ts";
import { GARAGES, LOTS } from "../data/index.ts";
import { forecastSource, planAhead, type PlanOption, type PlanResult } from "../lib/planahead.ts";
import { DAY_NAME, formatMinute } from "../lib/planask.ts";
import { formatMeters } from "../lib/nearby.ts";
import { PERMITS, SIGNAGE_NOTE, type PermitId } from "../lib/permits.ts";
import { filterByName } from "../lib/search.ts";
import type { Building, Selection } from "../types.ts";
import { esc } from "./format.ts";

export interface PlanViewOptions {
  getPermits: () => { permits: PermitId[]; ada: boolean };
  /** The driver toggled a permit here; the host persists it and keeps every other view in sync. */
  onPermits: (permits: PermitId[], ada: boolean) => void;
  onSelect: (sel: Selection) => void;
  now?: () => Date;
}
export interface PlanViewController {
  setPermits(permits: PermitId[], ada: boolean): void;
}

const LABEL_CLASS = { "Likely open": "pill-open", "Filling up": "pill-limited", Risky: "pill-full" } as const;

/** Next full hour inside class hours, else 9 am: a sensible "class starts at" default. */
export function defaultTime(d: Date): string {
  const h = d.getHours() + 1;
  return `${String(h >= 7 && h <= 19 ? h : 9).padStart(2, "0")}:00`;
}
export const defaultDay = (d: Date): number => (d.getDay() >= 1 && d.getDay() <= 5 ? d.getDay() : 3);

const card = (o: PlanOption, n: number | null): string => {
  const head = `<div class="plan-head"><strong>${n ? `${n}. ` : ""}${esc(o.name)}</strong>${
    o.verdict === "yes" ? `<span class="pill ${LABEL_CLASS[o.label]}">${esc(o.label)}</span>` : `<span class="acc-tag acc-check">Check sign</span>`
  }</div>`;
  const where = `<p class="plan-sub">${esc(formatMeters(o.meters))} &middot; about ${o.walkMin} min walk</p>`;
  const body =
    o.verdict === "yes"
      ? `<p class="plan-main">Forecast: about <strong>${o.predictedOpen}</strong> of ${o.capacity} open (${o.predictedPct}% full) at ${esc(formatMinute(o.arriveMinute))}</p>` +
        (o.bestLevel ? `<p class="plan-sub">Most room: ${esc(o.bestLevel.label)} (about ${o.bestLevel.predictedOpen} of ${o.bestLevel.capacity})</p>` : "") +
        (o.adaOpenEstimate !== undefined ? `<p class="plan-sub">About ${o.adaOpenEstimate} accessible spaces open</p>` : "") +
        `<p class="plan-sub">Right now on the map: ${o.nowOpen} open</p>`
      : `<p class="plan-sub">${esc(o.note ?? "We can't confirm your permit here - check the posted sign.")}</p>`;
  return `<li class="plan-card">${head}${where}${body}<button type="button" class="ref" data-kind="${o.kind}" data-id="${esc(o.id)}">Show on map</button></li>`;
};

export function renderPlanResult(r: PlanResult, input: { building: string; minute: number }): string {
  const src = forecastSource();
  if (r.needsPermit) return `<p class="plan-empty" role="status">Choose your permit above so I only suggest places you can legally use.</p>`;
  const when = `Class at ${formatMinute(input.minute)} ${DAY_NAME[r.dow] ?? ""} &middot; arriving about ${formatMinute(r.arriveMinute)}`;
  const recs = r.recommended.length
    ? `<ol class="plan-list">${r.recommended.map((o, i) => card(o, i + 1)).join("")}</ol>`
    : `<p class="plan-empty">No place I can confirm for your permit within a 25-minute walk of ${esc(input.building)} at that time.</p>`;
  const check = r.checkSign.length
    ? `<h3 class="plan-h">Nearby, but I can't confirm your permit</h3><ul class="plan-list">${r.checkSign.map((o) => card(o, null)).join("")}</ul>`
    : "";
  return `<h2 class="plan-title">${esc(input.building)}</h2><p class="plan-when">${when}</p>${recs}${check}
    <p class="fine">Forecast from a Databricks-trained model (${esc(src.model)}, ${esc(src.generated)}) on <strong>simulated</strong> demand shaped by VT's class timetable. It is not measured occupancy and has not been validated against real sensors.</p>
    <p class="fine">${esc(SIGNAGE_NOTE)}</p>`;
}

export function createPlanView(el: HTMLElement, opts: PlanViewOptions): PlanViewController {
  const clock = opts.now ?? (() => new Date());
  const t0 = clock();
  el.innerHTML = `
    <div class="plan">
      <form class="plan-form" id="plan-form" autocomplete="off" novalidate>
        <h2 class="plan-lead">Where should I park for class?</h2>
        <label for="plan-bldg">Destination building</label>
        <input id="plan-bldg" type="text" list="plan-bldgs" placeholder="e.g. Hancock Hall" spellcheck="false" autocapitalize="off">
        <datalist id="plan-bldgs">${BUILDINGS.map((b) => `<option value="${esc(b.name)}"></option>`).join("")}</datalist>
        <div class="plan-when-row">
          <div><label for="plan-day">Day</label>
            <select id="plan-day">${[1, 2, 3, 4, 5].map((d) => `<option value="${d}"${d === defaultDay(t0) ? " selected" : ""}>${DAY_NAME[d]}</option>`).join("")}</select></div>
          <div><label for="plan-time">Class starts</label><input id="plan-time" type="time" step="900" value="${defaultTime(t0)}"></div>
        </div>
        <fieldset class="plan-permits"><legend>Your permit</legend><div id="plan-permit-chips" class="plan-chips"></div></fieldset>
        <button type="submit" class="plan-go">Find parking</button>
        <p class="fine" id="plan-note">${t0.getDay() === 0 || t0.getDay() === 6 ? "It's the weekend, so the day defaults to a typical Wednesday. " : ""}Forecasts are simulated, not live sensor data.</p>
        <p class="plan-error" id="plan-error" role="alert" hidden></p>
      </form>
      <div id="plan-out" class="plan-out" aria-live="polite"></div>
    </div>`;

  const bldg = el.querySelector<HTMLInputElement>("#plan-bldg")!;
  const day = el.querySelector<HTMLSelectElement>("#plan-day")!;
  const time = el.querySelector<HTMLInputElement>("#plan-time")!;
  const chips = el.querySelector<HTMLElement>("#plan-permit-chips")!;
  const out = el.querySelector<HTMLElement>("#plan-out")!;
  const err = el.querySelector<HTMLElement>("#plan-error")!;
  let searched = false;

  function renderChips() {
    const { permits, ada } = opts.getPermits();
    const chip = (attr: string, on: boolean, text: string) =>
      `<button type="button" class="plan-chip${on ? " is-on" : ""}" role="switch" aria-checked="${on}" ${attr}>${esc(text)}</button>`;
    chips.innerHTML = PERMITS.map((p) => chip(`data-permit="${p.id}" title="${esc(p.detail)}"`, permits.includes(p.id), p.label)).join("") + chip("data-ada", ada, "Accessible plate / placard");
  }

  function resolveBuilding(): Building | null {
    const q = bldg.value.trim();
    if (!q) return null;
    const exact = BUILDINGS.find((b) => b.name.toLowerCase() === q.toLowerCase());
    if (exact) return exact;
    const hits = filterByName(BUILDINGS, q);
    return hits.length === 1 ? hits[0]! : null;
  }

  function showError(msg: string) {
    err.textContent = msg;
    err.hidden = false;
    out.innerHTML = "";
  }

  function run() {
    err.hidden = true;
    const b = resolveBuilding();
    if (!b) {
      const q = bldg.value.trim();
      return showError(!q ? "Pick a destination building first." : `I couldn't match "${q}" to one building. Choose from the suggestions as you type.`);
    }
    const [h, m] = time.value.split(":").map(Number);
    if (h === undefined || m === undefined || Number.isNaN(h) || Number.isNaN(m)) return showError("Choose the time your class starts.");
    const minute = h * 60 + m;
    const { permits, ada } = opts.getPermits();
    const r = planAhead({ building: b, dow: Number(day.value), minute, permits, ada }, { garages: GARAGES, lots: LOTS });
    out.innerHTML = renderPlanResult(r, { building: b.name, minute });
    searched = true;
  }

  el.querySelector("#plan-form")!.addEventListener("submit", (e) => {
    e.preventDefault();
    run();
    // The form is tall on a phone: bring the answer into view (only on an explicit submit, not on auto re-runs).
    out.scrollIntoView({ block: "start", behavior: "smooth" });
  });
  for (const c of [day, time]) c.addEventListener("change", () => searched && run());
  bldg.addEventListener("change", () => searched && run());
  chips.addEventListener("click", (e) => {
    const t = e.target as Element;
    const { permits, ada } = opts.getPermits();
    const p = t.closest<HTMLElement>("[data-permit]");
    if (p) {
      const id = p.dataset.permit as PermitId;
      opts.onPermits(permits.includes(id) ? permits.filter((x) => x !== id) : [...permits, id], ada);
    } else if (t.closest("[data-ada]")) opts.onPermits(permits, !ada);
  });
  out.addEventListener("click", (e) => {
    const b = (e.target as Element).closest<HTMLElement>("button.ref");
    if (b) opts.onSelect({ kind: b.dataset.kind as "garage" | "lot", id: b.dataset.id! });
  });

  renderChips();
  return {
    setPermits() {
      renderChips();
      if (searched) run();
    },
  };
}
