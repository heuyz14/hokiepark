import { createStore, sameSelection, type State, type View } from "./state.ts";
import type { Selection } from "./types.ts";
import { createMap } from "./ui/map.ts";
import { createSheet } from "./ui/sheet.ts";
import { createList } from "./ui/list.ts";
import { renderLegend } from "./ui/legend.ts";
import { createAssistant } from "./ui/assistant.ts";
import { createPermitPicker, loadSaved, save as savePermits } from "./ui/permits.ts";
import { createPlanView } from "./ui/plan.ts";
import { nowOf, withPlanAhead } from "./lib/planask.ts";
import { makeLocalAnswerer } from "./lib/assistant.ts";
import { ADVISOR_CONFIG, LIVE_CONFIG } from "./config.ts";
import { createAdvisor, httpTransport, withAdvisor } from "./lib/advisor.ts";
import { startLive } from "./live.ts";
import { createSyncChip } from "./ui/sync.ts";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

function boot() {
  const saved = loadSaved();
  const store = createStore({ view: "map", selection: null, source: null, query: "", permits: saved.permits, ada: saved.ada });
  const select = (selection: Selection, source: NonNullable<State["source"]>, view?: View) =>
    store.set({ selection, source, ...(view ? { view } : {}) });

  const map = createMap($("map"), (sel) => select(sel, "map"));
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
  // Apply whatever was remembered from last visit before the first paint.
  picker.set(saved.permits, saved.ada);
  map.setPermits(saved.permits, saved.ada);
  list.setPermits(saved.permits, saved.ada);
  sheet.setPermits(saved.permits, saved.ada);

  const views: Record<View, HTMLElement> = { map: $("view-map"), list: $("view-list"), ask: $("view-ask"), plan: $("view-plan") };
  const tabs = [...document.querySelectorAll<HTMLButtonElement>(".tabbar button")];

  // Swap this for an LLM-backed Answerer here if a backend proxy is ever added (it should receive the same context).
  const askContext = () => ({ permits: store.get().permits, ada: store.get().ada });
  // Plan-ahead questions ("2pm class at Hancock") are answered from the Databricks forecast; everything else goes to the normal assistant.
  const rules = withPlanAhead(makeLocalAnswerer(askContext), askContext);
  // Optional Gemini advisor (docs/GEMINI_NLP_SPEC.md): it only picks tools and explains their results; any failure falls back to `rules`.
  const answer = ADVISOR_CONFIG
    ? withAdvisor(rules, createAdvisor({ transport: httpTransport(ADVISOR_CONFIG), getContext: () => ({ now: nowOf(), permits: store.get().permits, ada: store.get().ada }) }))
    : rules;
  createAssistant($("view-ask"), { answer, onSelect: (sel) => select(sel, "assistant", "map"), advisor: ADVISOR_CONFIG !== null });
  const plan = createPlanView($("view-plan"), {
    getPermits: () => ({ permits: store.get().permits, ada: store.get().ada }),
    onPermits: (permits, ada) => {
      savePermits(permits, ada);
      picker.set(permits, ada);
      store.set({ permits, ada });
    },
    onSelect: (sel) => select(sel, "assistant", "map"),
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
  const chip = createSyncChip($("sync"), { state: LIVE_CONFIG ? "connecting" : "demo", lastSync: null, dataAsOf: null });
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
  $("locate-me").addEventListener("click", () => map.locate());
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
