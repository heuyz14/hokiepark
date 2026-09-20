import { buildingCodes } from "../data/building-abbreviations.ts";
import { BUILDINGS, GARAGES, LOTS } from "../data/index.ts";
import { forecastSource, planAhead, type PlanOption, type PlanResult } from "../lib/planahead.ts";
import { buildArrivalPlan } from "../lib/arrival-plan.ts";
import { DAY_NAME, formatMinute } from "../lib/planask.ts";
import { formatMeters } from "../lib/nearby.ts";
import { PERMITS, SIGNAGE_NOTE, type PermitId } from "../lib/permits.ts";
import { filterBuildings, resolveBuilding as findBuilding } from "../lib/search.ts";
import type { Building, Selection } from "../types.ts";
import { esc } from "./format.ts";
import { isSpeechSupported, speak, stopSpeech } from "../lib/speech.ts";

export interface PlanViewOptions {
  getPermits: () => { permits: PermitId[]; ada: boolean };
  /** The driver toggled a permit here; the host persists it and keeps every other view in sync. */
  onPermits: (permits: PermitId[], ada: boolean) => void;
  onSelect: (sel: Selection) => void;
  onShowRoute?: (origin: NonNullable<Selection>, destination: NonNullable<Selection>) => void;
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
  const where = `<p class="plan-sub">${esc(formatMeters(o.meters))} &middot; about ${o.walkMin} min ${o.routeType === "walk_graph" ? "walk via campus paths" : "straight-line walk estimate"}</p>`;
  const body =
    o.verdict === "yes"
      ? `<p class="plan-main">Forecast: about <strong>${o.predictedOpen}</strong> of ${o.capacity} open (${o.predictedPct}% full) at ${esc(formatMinute(o.arriveMinute))}</p>` +
        (o.bestLevel ? `<p class="plan-sub">Most room: ${esc(o.bestLevel.label)} (about ${o.bestLevel.predictedOpen} of ${o.bestLevel.capacity})</p>` : "") +
        (o.adaOpenEstimate !== undefined ? `<p class="plan-sub">About ${o.adaOpenEstimate} accessible spaces open</p>` : "") +
        `<p class="plan-sub">Right now on the map: ${o.nowOpen} open</p>`
      : `<p class="plan-sub">${esc(o.note ?? "We can't confirm your permit here - check the posted sign.")}</p>`;
  return `<li class="plan-card">${head}${where}${body}<button type="button" class="ref" data-kind="${o.kind}" data-id="${esc(o.id)}">Show on map</button><button type="button" class="ref" data-route-kind="${o.kind}" data-route-id="${esc(o.id)}">Show walking route</button></li>`;
};

export function renderPlanResult(r: PlanResult, input: { building: string; minute: number }): string {
  const src = forecastSource();
  if (r.needsPermit) return `<p class="plan-empty" role="status">Choose your permit above so I only suggest places you can legally use.</p>`;
  const when = `Class at ${formatMinute(input.minute)} ${DAY_NAME[r.dow] ?? ""} &middot; arriving about ${formatMinute(r.arriveMinute)}`;
  const recs = r.recommended.length
    ? `<ol class="plan-list">${r.recommended.map((o, i) => card(o, i + 1)).join("")}</ol>`
    : `<p class="plan-empty">No place I can confirm for your permit within a 25-minute walk of ${esc(input.building)} at that time.</p>`;
  const arrival = r.recommended[0]
    ? (() => {
        const plan = buildArrivalPlan({ destinationName: input.building, targetMinute: input.minute, recommendedLot: r.recommended[0]! });
        return `<section class="arrival-plan" aria-label="Your arrival plan"><h3 class="plan-h">Your arrival plan</h3>
          <p class="plan-main"><strong>${esc(plan.recommendedLotName)}</strong> is the recommended parking option.</p>
          <ol class="arrival-steps">${plan.steps.map((step) => `<li><time>${esc(formatMinute(step.minute))}</time><span>${esc(step.label)}${step.durationMinutes ? ` · about ${step.durationMinutes} min` : ""}</span></li>`).join("")}
          <li><time>${esc(formatMinute(plan.targetMinute))}</time><span>Arrive at ${esc(plan.destinationName)}</span></li></ol>
          <p class="fine">${esc(plan.assumptions.join(" "))}</p>
          ${isSpeechSupported() ? `<button type="button" class="ref" data-read-plan>Read plan aloud</button><button type="button" class="ref" data-stop-plan>Stop reading</button>` : ""}
        </section>`;
      })()
    : "";
  const check = r.checkSign.length
    ? `<h3 class="plan-h">Nearby, but I can't confirm your permit</h3><ul class="plan-list">${r.checkSign.map((o) => card(o, null)).join("")}</ul>`
    : "";
  return `<h2 class="plan-title">${esc(input.building)}</h2><p class="plan-when">${when}</p>${arrival}${recs}${check}
    <p class="fine">Forecast from a Databricks-trained model (${esc(src.model)}, ${esc(src.generated)}) on <strong>simulated</strong> demand shaped by VT's class timetable. It is not measured occupancy and has not been validated against real sensors.</p>
    <p class="fine">${esc(SIGNAGE_NOTE)}</p>`;
}

export interface BuildingOption {
  building: Building;
  codes: readonly string[];
}

/**
 * Every building A-Z, with its official Banner codes. This is what the picker shows before the
 * driver types anything: on a phone, tapping a field and being told "start typing" is a dead end
 * if you don't already know what the building is called.
 */
export function buildingOptions(buildings: readonly Building[] = BUILDINGS): BuildingOption[] {
  return [...buildings]
    .sort((a, b) => a.name.localeCompare(b.name, "en"))
    .map((building) => ({ building, codes: buildingCodes(building.num) }));
}

export function createPlanView(el: HTMLElement, opts: PlanViewOptions): PlanViewController {
  const clock = opts.now ?? (() => new Date());
  const t0 = clock();
  el.innerHTML = `
    <div class="plan">
      <form class="plan-form" id="plan-form" autocomplete="off" novalidate>
        <h2 class="plan-lead">Where should I park for class?</h2>
        <label for="plan-bldg">Destination building</label>
        <div class="combo">
          <input id="plan-bldg" type="text" role="combobox" aria-expanded="false" aria-controls="plan-bldg-list" aria-autocomplete="list"
            placeholder="Tap to pick, or type a name or code" spellcheck="false" autocapitalize="off">
          <ul id="plan-bldg-list" class="combo-list" role="listbox" aria-label="Campus buildings" hidden></ul>
        </div>
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
  const list = el.querySelector<HTMLElement>("#plan-bldg-list")!;
  const day = el.querySelector<HTMLSelectElement>("#plan-day")!;
  const time = el.querySelector<HTMLInputElement>("#plan-time")!;
  const chips = el.querySelector<HTMLElement>("#plan-permit-chips")!;
  const out = el.querySelector<HTMLElement>("#plan-out")!;
  const err = el.querySelector<HTMLElement>("#plan-error")!;
  let searched = false;
  let latestBuilding: Building | null = null;

  function renderChips() {
    const { permits, ada } = opts.getPermits();
    const chip = (attr: string, on: boolean, text: string) =>
      `<button type="button" class="plan-chip${on ? " is-on" : ""}" role="switch" aria-checked="${on}" ${attr}>${esc(text)}</button>`;
    chips.innerHTML = PERMITS.map((p) => chip(`data-permit="${p.id}" title="${esc(p.detail)}"`, permits.includes(p.id), p.label)).join("") + chip("data-ada", ada, "Accessible plate / placard");
  }

  function resolveBuilding(): Building | null {
    return findBuilding(BUILDINGS, bldg.value);
  }

  // --- destination picker: a listbox that opens on tap, not only once you've typed ---
  const ALL = buildingOptions();
  let shown: BuildingOption[] = [];
  let active = -1;

  const optionId = (i: number) => `plan-bldg-opt-${i}`;

  function paint() {
    list.innerHTML = shown.length
      ? shown
          .map(
            (o, i) =>
              `<li role="option" id="${optionId(i)}" class="combo-opt${i === active ? " is-active" : ""}" aria-selected="${i === active}" data-i="${i}">` +
              `<span class="combo-name">${esc(o.building.name)}</span>${o.codes.length ? `<span class="combo-code">${esc(o.codes.join(", "))}</span>` : ""}</li>`,
          )
          .join("")
      : `<li class="combo-empty" role="presentation">No building matches that. Try a shorter name, or a code like HAN.</li>`;
    bldg.setAttribute("aria-activedescendant", active >= 0 && shown.length ? optionId(active) : "");
  }

  function open(query = bldg.value) {
    const q = query.trim();
    const hits = q ? filterBuildings(BUILDINGS, q) : [];
    // Typing filters; an empty box shows the whole campus A-Z.
    shown = q ? ALL.filter((o) => hits.some((h) => h.id === o.building.id)) : ALL;
    active = -1;
    paint();
    list.hidden = false;
    bldg.setAttribute("aria-expanded", "true");
  }

  function close() {
    list.hidden = true;
    bldg.setAttribute("aria-expanded", "false");
    bldg.setAttribute("aria-activedescendant", "");
    active = -1;
  }

  function choose(i: number) {
    const o = shown[i];
    if (!o) return;
    bldg.value = o.building.name;
    close();
    if (searched) run();
  }

  function move(step: number) {
    if (list.hidden) return open();
    if (!shown.length) return;
    active = (active + step + shown.length) % shown.length;
    paint();
    list.querySelector(".is-active")?.scrollIntoView({ block: "nearest" });
  }

  bldg.addEventListener("focus", () => open());
  bldg.addEventListener("click", () => open());
  bldg.addEventListener("input", () => open());
  bldg.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); move(1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); move(-1); }
    else if (e.key === "Enter" && !list.hidden && active >= 0) { e.preventDefault(); choose(active); }
    else if (e.key === "Escape" && !list.hidden) { e.preventDefault(); close(); }
    else if (e.key === "Tab") close();
  });
  // mousedown, not click: the input blurs first and would close the list out from under the tap.
  list.addEventListener("mousedown", (e) => {
    const li = (e.target as Element).closest<HTMLElement>("[data-i]");
    if (!li) return;
    e.preventDefault();
    choose(Number(li.dataset.i));
  });
  document.addEventListener("pointerdown", (e) => {
    if (!list.hidden && !el.contains(e.target as Node)) close();
  }, true);
  bldg.addEventListener("blur", () => setTimeout(close, 120));

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
    latestBuilding = b;
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
    const route = (e.target as Element).closest<HTMLElement>("[data-route-id]");
    if (route && latestBuilding) opts.onShowRoute?.({ kind: route.dataset.routeKind as "garage" | "lot", id: route.dataset.routeId! }, { kind: "building", id: latestBuilding.id });
    if ((e.target as Element).closest("[data-read-plan]")) speak(out.textContent ?? "");
    if ((e.target as Element).closest("[data-stop-plan]")) stopSpeech();
  });

  renderChips();
  return {
    setPermits() {
      renderChips();
      if (searched) run();
    },
  };
}
