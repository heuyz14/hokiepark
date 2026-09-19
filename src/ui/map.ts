import { BUILDINGS, GARAGES, LOTS } from "../data/index.ts";
import { DRILLFIELD, DRILLFIELD_CENTER } from "../data/drillfield.ts";
import type { Footprint, Selection } from "../types.ts";
import { footprintToPath, makeProjector, type Projector } from "../lib/projection.ts";
import { centeredOn, clamp, easeInOutCubic, fitAspect, lerpBox, panBy, zoomAt, type ViewBox } from "../lib/viewport.ts";
import { garageStatus, garageTotals } from "../lib/occupancy.ts";
import { esc } from "./format.ts";

export interface MapController {
  /** Highlight a selection. `fly` recenters/zooms on it; otherwise only nudges it out from under the sheet. */
  setSelection(sel: Selection, opts: { fly: boolean }): void;
  zoom(factor: number): void;
  reset(): void;
}

/** Labeled at every zoom; chosen to be far enough apart not to collide at full-campus view. */
const LANDMARKS = new Set(["Burruss Hall", "Squires Student Center", "Newman Library", "Lane Stadium", "Cassell Coliseum", "War Memorial Gymnasium"]);
/** Screen-space room kept around the campus at full view so edge markers (100 px pill) are not clipped. */
const EDGE_PAD_PX = 62;
const MAX_ZOOM = 14;
const FLY_MS = 450;
const TAP_SLOP_PX = 6;

interface Anchor {
  x: number;
  y: number;
  /** Footprint width in meters; drives the fly-to zoom level. */
  size: number;
}

const bounds = (pts: { x: number; y: number }[]) => {
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
};

const project = (fp: Footprint, p: Projector) => fp.flat().map(([lon, lat]) => p(lat, lon));

function wheelchairMini(x: number, y: number, size: number): string {
  return `<use href="#i-wheelchair" x="${x}" y="${y}" width="${size}" height="${size}"/>`;
}

export function createMap(el: HTMLElement, onSelect: (sel: Selection) => void): MapController {
  const proj = makeProjector(DRILLFIELD_CENTER);
  const anchors = new Map<string, Anchor>();
  const key = (kind: string, id: string) => `${kind}:${id}`;
  const allPts: { x: number; y: number }[] = [];

  const register = (kind: string, id: string, lat: number, lon: number, fp: Footprint) => {
    const pts = project(fp, proj);
    allPts.push(...pts);
    const b = bounds(pts);
    const c = proj(lat, lon);
    anchors.set(key(kind, id), { x: c.x, y: c.y, size: b.maxX - b.minX });
    return c;
  };

  const lotsSvg = LOTS.map((l) => {
    register("lot", l.id, l.lat, l.lon, l.footprint);
    return `<path class="lot${l.hasADA ? " lot-ada" : ""}" data-kind="lot" data-id="${l.id}" d="${footprintToPath(l.footprint, proj)}"><title>${esc(l.name)} lot</title></path>`;
  }).join("");

  const buildingsSvg = BUILDINGS.map((b) => {
    register("building", b.id, b.lat, b.lon, b.footprint);
    return `<path class="bldg cat-${b.category}" data-kind="building" data-id="${b.id}" d="${footprintToPath(b.footprint, proj)}"><title>${esc(b.name)}</title></path>`;
  }).join("");

  const garagePathsSvg = GARAGES.map((g) => {
    register("garage", g.id, g.lat, g.lon, g.footprint);
    return `<path class="garage" data-kind="garage" data-id="${g.id}" d="${footprintToPath(g.footprint, proj)}"><title>${esc(g.name)}</title></path>`;
  }).join("");

  const labelsSvg = BUILDINGS.map((b) => {
    const a = anchors.get(key("building", b.id))!;
    return `<text class="bldg-label${LANDMARKS.has(b.name) ? " lm" : ""}" data-scale data-x="${a.x.toFixed(1)}" data-y="${a.y.toFixed(1)}" dy="22" text-anchor="middle">${esc(b.name)}</text>`;
  }).join("");

  const drillAnchor = proj(DRILLFIELD_CENTER.lat, DRILLFIELD_CENTER.lon);
  allPts.push(...project(DRILLFIELD, proj));

  const garageMarkers = GARAGES.map((g) => {
    const a = anchors.get(key("garage", g.id))!;
    const t = garageTotals(g);
    const st = garageStatus(g);
    const count = st === "full" ? "Full" : String(t.open);
    const label = `${g.name}: ${t.open} of ${t.capacity} spaces open, ${t.adaOpen} accessible open`;
    return `<g class="marker marker-garage st-${st}" data-scale data-kind="garage" data-id="${g.id}" data-x="${a.x.toFixed(1)}" data-y="${a.y.toFixed(1)}" tabindex="0" role="button" aria-label="${esc(label)}">
      <rect class="m-bg" x="-50" y="-15" width="100" height="30" rx="15"/>
      <text class="m-p" x="-36" y="5" text-anchor="middle">P</text>
      <text class="m-count" x="-8" y="5" text-anchor="middle">${count}</text>
      <rect class="m-ada-bg" x="12" y="-13" width="36" height="26" rx="13"/>
      ${wheelchairMini(15, -8, 16)}
      <text class="m-ada-count" x="40" y="5" text-anchor="middle">${t.adaOpen}</text>
    </g>`;
  }).join("");

  const lotMarkers = LOTS.map((l) => {
    const a = anchors.get(key("lot", l.id))!;
    const label = `${l.name} lot, ${l.permit}${l.hasADA ? ", accessible parking available" : ""}`;
    return `<g class="marker marker-lot${l.hasADA ? " has-ada" : ""}" data-scale data-kind="lot" data-id="${l.id}" data-x="${a.x.toFixed(1)}" data-y="${a.y.toFixed(1)}" tabindex="0" role="button" aria-label="${esc(label)}">
      <circle class="m-bg" r="10"/>
      <text class="m-p" y="4.5" text-anchor="middle">P</text>
      ${l.hasADA ? `<circle class="m-ada-dot" cx="10" cy="-10" r="8.5"/>${wheelchairMini(4.5, -15.5, 11)}` : ""}
    </g>`;
  }).join("");

  // Full extent of all drawn geometry, padded so edge markers are not clipped.
  const b = bounds(allPts);
  const pad = Math.max(b.maxX - b.minX, b.maxY - b.minY) * 0.04;
  const extent: ViewBox = { x: b.minX - pad, y: b.minY - pad, w: b.maxX - b.minX + pad * 2, h: b.maxY - b.minY + pad * 2 };

  el.innerHTML = `<svg class="map-svg" xmlns="http://www.w3.org/2000/svg" viewBox="${extent.x} ${extent.y} ${extent.w} ${extent.h}" role="group" aria-label="Map of Virginia Tech campus parking. Use the List tab for a text alternative.">
    <path class="drill" d="${footprintToPath(DRILLFIELD, proj)}"/>
    <text class="drill-label" data-scale data-x="${drillAnchor.x.toFixed(1)}" data-y="${drillAnchor.y.toFixed(1)}" text-anchor="middle">The Drillfield</text>
    <g>${lotsSvg}</g><g>${buildingsSvg}</g><g>${garagePathsSvg}</g>
    <g class="labels">${labelsSvg}</g>
    <g class="markers">${lotMarkers}${garageMarkers}</g>
  </svg>`;
  el.removeAttribute("aria-busy");

  const svg = el.querySelector<SVGSVGElement>("svg")!;
  const scaled = [...svg.querySelectorAll<SVGGraphicsElement>("[data-scale]")];

  let home = extent;
  let vb = extent;
  let lastW = -1;
  let raf = 0;
  const reduceMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const pxPerMeter = () => (el.clientWidth || 1) / vb.w;

  function setView(next: ViewBox) {
    vb = next;
    svg.setAttribute("viewBox", `${vb.x} ${vb.y} ${vb.w} ${vb.h}`);
    if (Math.abs(vb.w - lastW) > 1e-6) {
      lastW = vb.w;
      const s = 1 / pxPerMeter();
      for (const n of scaled) n.setAttribute("transform", `translate(${n.dataset.x} ${n.dataset.y}) scale(${s.toFixed(4)})`);
      svg.classList.toggle("show-all-labels", pxPerMeter() > 1.15);
      // Overview shows only garages + ADA lots; the other lot markers appear once zoomed in (they stay tappable as polygons and in the List).
      svg.classList.toggle("show-all-lots", pxPerMeter() > 0.6);
    }
  }

  function cancelFly() {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  }

  function flyTo(target: ViewBox) {
    cancelFly();
    if (reduceMotion()) return setView(target);
    const from = vb;
    const t0 = performance.now();
    const step = (now: number) => {
      const t = clamp((now - t0) / FLY_MS, 0, 1);
      setView(lerpBox(from, target, easeInOutCubic(t)));
      raf = t < 1 ? requestAnimationFrame(step) : 0;
    };
    raf = requestAnimationFrame(step);
  }

  /** View of `width` meters with the anchor placed 30% from the top, clear of the bottom sheet. */
  const boxFor = (a: Anchor, width: number): ViewBox => {
    const c = centeredOn(a.x, a.y, width, vb);
    return { ...c, y: a.y - c.h * 0.3 };
  };

  // Keep the drawn aspect equal to the container so pointer math stays linear.
  let sized = false;
  new ResizeObserver(() => {
    const w = el.clientWidth;
    const h = el.clientHeight;
    if (!w || !h) return; // hidden tab
    const mPerPx = Math.max(extent.w / w, extent.h / h);
    const pad = EDGE_PAD_PX * mPerPx;
    home = fitAspect({ x: extent.x - pad, y: extent.y - pad, w: extent.w + pad * 2, h: extent.h + pad * 2 }, w / h);
    lastW = -1; // force marker rescale: px-per-meter changed with the container width
    setView(sized ? { ...vb, h: vb.w / (w / h) } : home);
    sized = true;
  }).observe(el);

  // --- input: drag to pan, pinch/wheel to zoom, tap to select ---
  const pointers = new Map<number, { x: number; y: number }>();
  let downTarget: Element | null = null;
  let moved = false;
  let start = { x: 0, y: 0 };
  let pinchDist = 0;

  const selectFrom = (target: Element | null) => {
    const hit = target?.closest<SVGElement>("[data-kind]");
    onSelect(hit ? { kind: hit.dataset.kind as "garage" | "lot" | "building", id: hit.dataset.id! } : null);
  };

  svg.addEventListener("pointerdown", (e) => {
    cancelFly();
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 1) {
      downTarget = e.target as Element;
      moved = false;
      start = { x: e.clientX, y: e.clientY };
    } else {
      moved = true;
      const [a, c] = [...pointers.values()];
      pinchDist = Math.hypot(a!.x - c!.x, a!.y - c!.y);
    }
  });

  svg.addEventListener("pointermove", (e) => {
    const prev = pointers.get(e.pointerId);
    if (!prev) return;
    const cur = { x: e.clientX, y: e.clientY };
    pointers.set(e.pointerId, cur);
    const rect = svg.getBoundingClientRect();
    if (pointers.size === 1) {
      if (!moved) {
        if (Math.hypot(cur.x - start.x, cur.y - start.y) < TAP_SLOP_PX) return;
        moved = true;
        svg.setPointerCapture(e.pointerId);
        svg.classList.add("dragging");
      }
      setView(panBy(vb, ((cur.x - prev.x) * vb.w) / rect.width, ((cur.y - prev.y) * vb.h) / rect.height, home));
    } else if (pointers.size === 2) {
      const [a, c] = [...pointers.values()];
      const d = Math.hypot(a!.x - c!.x, a!.y - c!.y);
      if (pinchDist > 0) {
        const mx = (a!.x + c!.x) / 2;
        const my = (a!.y + c!.y) / 2;
        setView(zoomAt(vb, d / pinchDist, (mx - rect.left) / rect.width, (my - rect.top) / rect.height, home, MAX_ZOOM));
      }
      pinchDist = d;
    }
  });

  const endPointer = (e: PointerEvent) => {
    const wasTap = e.type === "pointerup" && pointers.size === 1 && !moved;
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinchDist = 0;
    if (pointers.size === 0) svg.classList.remove("dragging");
    if (wasTap) selectFrom(downTarget);
  };
  svg.addEventListener("pointerup", endPointer);
  svg.addEventListener("pointercancel", endPointer);

  svg.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      cancelFly();
      const rect = svg.getBoundingClientRect();
      const factor = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015));
      setView(zoomAt(vb, factor, (e.clientX - rect.left) / rect.width, (e.clientY - rect.top) / rect.height, home, MAX_ZOOM));
    },
    { passive: false },
  );

  svg.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const marker = (e.target as Element).closest("[data-kind]");
    if (!marker) return;
    e.preventDefault();
    selectFrom(marker);
  });

  return {
    setSelection(sel, { fly }) {
      for (const n of svg.querySelectorAll(".is-selected")) n.classList.remove("is-selected");
      if (!sel) return;
      for (const n of svg.querySelectorAll<SVGElement>("[data-kind]")) {
        if (n.dataset.kind === sel.kind && n.dataset.id === sel.id) n.classList.add("is-selected");
      }
      const a = anchors.get(key(sel.kind, sel.id));
      if (!a) return;
      // ~3x the footprint so the whole lot/garage plus some context fits; capped for huge lots.
      const width = clamp(a.size * 3, 200, 520);
      if (fly) return flyTo(boxFor(a, width));
      // Tapped on the map: only move if the item is hidden behind the sheet or off-screen.
      const fx = (a.x - vb.x) / vb.w;
      const fy = (a.y - vb.y) / vb.h;
      if (fy > 0.5 || fy < 0.05 || fx < 0.05 || fx > 0.95) flyTo(boxFor(a, Math.min(vb.w, Math.max(width, 260))));
    },
    zoom(factor) {
      cancelFly();
      setView(zoomAt(vb, factor, 0.5, 0.5, home, MAX_ZOOM));
    },
    reset() {
      flyTo(home);
    },
  };
}
