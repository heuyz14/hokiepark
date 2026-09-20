import { createStore, sameSelection, type State, type View } from "./state.ts";
import type { Selection } from "./types.ts";
import { BUILDINGS, GARAGES, LOTS } from "./data/index.ts";
import { calculateCampusWalkingRoute } from "./lib/walk-network.ts";
import { createMap } from "./ui/map.ts";
import { createSheet } from "./ui/sheet.ts";
import { createList } from "./ui/list.ts";
import { renderLegend } from "./ui/legend.ts";
import { createAssistant } from "./ui/assistant.ts";
import { createPermitPicker } from "./ui/permits.ts";
import { createPlanView } from "./ui/plan.ts";
import { nowOf, withPlanAhead } from "./lib/planask.ts";
import { makeLocalAnswerer } from "./lib/assistant.ts";
import { ADVISOR_CONFIG, LIVE_CONFIG } from "./config.ts";
import { createAdvisor, httpTransport, withAdvisor } from "./lib/advisor.ts";
import { startLive } from "./live.ts";
import { createSyncChip } from "./ui/sync.ts";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

function boot() {
  const store = createStore({ view: "map", selection: null, source: null, query: "", permits: [], ada: false });
  let currentLocation: { lat: number; lon: number; accuracyMeters?: number } | undefined;
  const select = (selection: Selection, source: NonNullable<State["source"]>, view?: View) =>
    store.set({ selection, source, ...(view ? { view } : {}) });

  const map = createMap($("map"), (sel) => select(sel, "map"), { onLocation: (location) => { currentLocation = location; } });
  const sheet = createSheet($("sheet"), {
    onClose: () => select(null, "sheet"),
    onSelect: (sel) => select(sel, "sheet"),
  });
  const list = createList($("view-list"), {
    onSelect: (sel) => select(sel, "list", "map"), // list -> map: fly-to + sheet
    onQuery: (query) => store.set({ query }),
  });
  renderLegend($("legend"));
  const picker = createPermitPicker($("permit-picker"), (permits, ada) => store.set({ permits, ada }));
  map.setPermits([], false);
  list.setPermits([], false);
  sheet.setPermits([], false);

  const views: Record<View, HTMLElement> = { map: $("view-map"), list: $("view-list"), ask: $("view-ask"), plan: $("view-plan") };
  const tabs = [...document.querySelectorAll<HTMLButtonElement>(".tabbar button")];

  // Swap this for an LLM-backed Answerer here if a backend proxy is ever added (it should receive the same context).
  const askContext = () => ({ permits: store.get().permits, ada: store.get().ada });
  // Plan-ahead questions ("2pm class at Hancock") are answered from the Databricks forecast; everything else goes to the normal assistant.
  const rules = withPlanAhead(makeLocalAnswerer(askContext), askContext);
  // Optional Gemini advisor (docs/advisor/ADVISOR.md): it only picks tools and explains their results; any failure falls back to `rules`.
  const answer = ADVISOR_CONFIG
    ? withAdvisor(rules, createAdvisor({ transport: httpTransport(ADVISOR_CONFIG), getContext: () => ({ now: nowOf(), permits: store.get().permits, ada: store.get().ada, currentLocation }) }))
    : rules;
  createAssistant($("view-ask"), { answer, onSelect: (sel) => select(sel, "assistant", "map"), advisor: ADVISOR_CONFIG !== null, ensureCurrentLocation: () => map.locate() });
  const plan = createPlanView($("view-plan"), {
    getPermits: () => ({ permits: store.get().permits, ada: store.get().ada }),
    onPermits: (permits, ada) => {
      picker.set(permits, ada);
      store.set({ permits, ada });
    },
    onSelect: (sel) => select(sel, "assistant", "map"),
    onShowRoute: (origin, destination) => {
      const from = origin.kind === "garage" ? GARAGES.find((place) => place.id === origin.id) : LOTS.find((place) => place.id === origin.id);
      const to = BUILDINGS.find((place) => place.id === destination.id);
      if (!from || !to) return;
      const route = calculateCampusWalkingRoute(from, to);
      map.showRoute(route?.geometry ?? [{ lat: from.lat, lon: from.lon }, { lat: to.lat, lon: to.lon }], route ? "walk_graph" : "straight_line_estimate");
      store.set({ view: "map", selection: origin, source: "assistant" });
    },
  });

  store.subscribe((s, prev) => {
    if (s.view !== prev.view) {
      for (const [v, node] of Object.entries(views)) node.hidden = v !== s.view;
      for (const t of tabs) t.toggleAttribute("aria-current", t.dataset.view === s.view);
    }
    const selChanged = !sameSelection(s.selection, prev.selection);
    if (selChanged || s.view !== prev.view) {
      sheet.render(s.view === "map" ? s.selection : null);
      if (s.view === "map") map.setSelection(s.selection, { fly: s.source !== "map" && s.source !== null && selChanged });
    }
    if (selChanged) list.setSelected(s.selection);
    if (s.permits !== prev.permits || s.ada !== prev.ada) {
      map.setPermits(s.permits, s.ada);
      list.setPermits(s.permits, s.ada);
      sheet.setPermits(s.permits, s.ada);
      sheet.render(s.view === "map" ? s.selection : null);
      plan.setPermits(s.permits, s.ada);
    }
    if (selChanged && s.selection && s.source !== "map" && s.view === "map") {
      document.getElementById("sheet-title")?.focus({ preventScroll: true });
    }
  });

  // Live occupancy (optional). Without config the app just shows the bundled sample counts.
  const chip = createSyncChip($("sync"), { state: LIVE_CONFIG ? "connecting" : "demo", lastSync: null, dataAsOf: null }, LIVE_CONFIG?.pollMs);
  if (LIVE_CONFIG) {
    startLive(LIVE_CONFIG, {
      onStatus: chip.update,
      onChange() {
        map.refreshGarages();
        list.refresh();
        const s = store.get();
        if (s.selection?.kind === "garage" && s.view === "map") sheet.render(s.selection, { preserveScroll: true });
      },
    });
  }

  for (const t of tabs) t.addEventListener("click", () => store.set({ view: t.dataset.view as View }));
  $("zoom-in").addEventListener("click", () => map.zoom(1.6));
  $("zoom-out").addEventListener("click", () => map.zoom(1 / 1.6));
  $("locate-me").addEventListener("click", () => void map.locate());
  $("zoom-reset").addEventListener("click", () => {
    map.reset();
    if (store.get().selection) select(null, "sheet");
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && store.get().selection) select(null, "sheet");
  });
}

// Offline shell + installability. Service workers need https (or localhost), so skip on file://.
if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
  addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch((e) => console.warn("service worker not registered", e)));
}

try {
  boot();
} catch (err) {
  console.error(err);
  $("map").innerHTML = `<p class="state-msg" role="alert">Something went wrong drawing the map. Try reloading the page.</p>`;
}
