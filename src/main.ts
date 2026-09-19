import { createStore, sameSelection, type State, type View } from "./state.ts";
import type { Selection } from "./types.ts";
import { createMap } from "./ui/map.ts";
import { createSheet } from "./ui/sheet.ts";
import { createList } from "./ui/list.ts";
import { renderLegend } from "./ui/legend.ts";
import { createAssistant } from "./ui/assistant.ts";
import { localAnswerer } from "./lib/assistant.ts";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

function boot() {
  const store = createStore({ view: "map", selection: null, source: null, query: "" });
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

  const views: Record<View, HTMLElement> = { map: $("view-map"), list: $("view-list"), ask: $("view-ask") };
  const tabs = [...document.querySelectorAll<HTMLButtonElement>(".tabbar button")];

  // Swap `localAnswerer` for an LLM-backed Answerer here if a backend proxy is ever added.
  createAssistant($("view-ask"), { answer: localAnswerer, onSelect: (sel) => select(sel, "assistant", "map") });

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
    if (selChanged && s.selection && s.source !== "map" && s.view === "map") {
      document.getElementById("sheet-title")?.focus({ preventScroll: true });
    }
  });

  for (const t of tabs) t.addEventListener("click", () => store.set({ view: t.dataset.view as View }));
  $("zoom-in").addEventListener("click", () => map.zoom(1.6));
  $("zoom-out").addEventListener("click", () => map.zoom(1 / 1.6));
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
