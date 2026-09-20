import { PERMITS, type PermitId } from "../lib/permits.ts";
import { esc } from "./format.ts";

export interface PermitPickerController {
  set(permits: PermitId[], ada: boolean): void;
}

const STORE_KEY = "hokiepark.permits.v1";

/** Remembers the driver's permits between visits; a blocked/private store just means no memory. */
export function loadSaved(): { permits: PermitId[]; ada: boolean } {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return { permits: [], ada: false };
    const v = JSON.parse(raw) as { permits?: unknown; ada?: unknown };
    const valid = new Set(PERMITS.map((p) => p.id));
    return {
      permits: Array.isArray(v.permits) ? (v.permits.filter((p) => typeof p === "string" && valid.has(p as PermitId)) as PermitId[]) : [],
      ada: v.ada === true,
    };
  } catch {
    return { permits: [], ada: false };
  }
}

export function save(permits: PermitId[], ada: boolean) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify({ permits, ada }));
  } catch {
    /* private mode: the choice just won't persist */
  }
}

/**
 * The permit chooser: a collapsed chip in the map's top-left that opens a panel of toggles.
 * Multi-select, because a driver can hold more than one permit, and because the honest answer to
 * "can I park here" is the best verdict across everything they hold.
 */
export function createPermitPicker(el: HTMLElement, onChange: (permits: PermitId[], ada: boolean) => void): PermitPickerController {
  let permits: PermitId[] = [];
  let ada = false;
  let open = false;

  const summary = () => {
    if (!permits.length && !ada) return "Set your permit";
    const names = PERMITS.filter((p) => permits.includes(p.id)).map((p) => p.label);
    if (ada) names.push("Accessible");
    return names.length === 1 ? names[0]! : `${names.length} permits`;
  };

  function render() {
    const toggles = PERMITS.map((p) => {
      const on = permits.includes(p.id);
      return `<li><button type="button" class="permit-opt${on ? " is-on" : ""}" role="switch" aria-checked="${on}" data-permit="${p.id}">
        <span class="permit-box" aria-hidden="true"></span>
        <span class="permit-text"><strong>${esc(p.label)}</strong><span>${esc(p.detail)}</span></span>
      </button></li>`;
    }).join("");

    el.innerHTML = `
      <button type="button" class="permit-chip${permits.length || ada ? " is-set" : ""}" aria-expanded="${open}" aria-controls="permit-panel">
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><rect x="2" y="5.5" width="20" height="13" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.9"/><path d="M5.5 10h2.2M10.4 10h3.2M16.3 10h2.2M5.5 14h3.4M11.6 14h6.9" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/></svg>
        <span>${esc(summary())}</span>
      </button>
      <div id="permit-panel" class="permit-panel" ${open ? "" : "hidden"}>
        <h2>Which permit do you have?</h2>
        <p class="permit-intro">We'll only show parking you can legally use.</p>
        <ul class="permit-list">${toggles}</ul>
        <button type="button" class="permit-opt permit-ada${ada ? " is-on" : ""}" role="switch" aria-checked="${ada}" data-ada>
          <span class="permit-box" aria-hidden="true"></span>
          <span class="permit-text"><strong>Accessible plate or placard</strong><span>Needed for ADA spaces; VT cites vehicles without valid credentials.</span></span>
        </button>
        <div class="permit-actions">
          <button type="button" class="permit-clear" data-clear>Clear all</button>
          <button type="button" class="permit-done" data-done>Done</button>
        </div>
      </div>`;
  }

  function commit() {
    save(permits, ada);
    onChange(permits, ada);
    render();
  }

  el.addEventListener("click", (e) => {
    const t = e.target as Element;
    if (t.closest(".permit-chip")) {
      open = !open;
      render();
      if (open) el.querySelector<HTMLElement>(".permit-opt")?.focus();
      return;
    }
    const opt = t.closest<HTMLElement>("[data-permit]");
    if (opt) {
      const id = opt.dataset.permit as PermitId;
      permits = permits.includes(id) ? permits.filter((p) => p !== id) : [...permits, id];
      return commit();
    }
    if (t.closest("[data-ada]")) {
      ada = !ada;
      return commit();
    }
    if (t.closest("[data-clear]")) {
      permits = [];
      ada = false;
      return commit();
    }
    if (t.closest("[data-done]")) {
      open = false;
      render();
      el.querySelector<HTMLElement>(".permit-chip")?.focus();
    }
  });

  el.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && open) {
      open = false;
      render();
      el.querySelector<HTMLElement>(".permit-chip")?.focus();
    }
  });

  // The panel floats over the map, so a tap meant for a marker would otherwise land on it and
  // silently toggle a permit. Anything outside the panel closes it first.
  document.addEventListener(
    "pointerdown",
    (e) => {
      if (!open || el.contains(e.target as Node)) return;
      open = false;
      render();
    },
    true,
  );

  render();

  return {
    set(nextPermits, nextAda) {
      permits = nextPermits;
      ada = nextAda;
      render();
    },
  };
}
