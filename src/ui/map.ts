import * as maplibregl from "maplibre-gl";
import { BUILDINGS, GARAGES, LOTS } from "../data/index.ts";
import { DRILLFIELD_CENTER } from "../data/drillfield.ts";
import type { Building, Footprint, Garage, Lot, Selection } from "../types.ts";
import { footprintBounds, footprintToGeoJSON } from "../lib/geojson.ts";
import { garageStatus, garageTotals } from "../lib/occupancy.ts";
import { classSummary, garageAccess, lotAccess, type LotClass, type PermitId } from "../lib/permits.ts";
import { esc, CATEGORY_COLOR, withLibraryClasses, markerScale } from "./format.ts";

export interface MapController {
  /** Highlight a selection. `fly` recenters/zooms on it; otherwise only nudges it out from under the sheet. */
  setSelection(sel: Selection, opts: { fly: boolean }): void;
  zoom(factor: number): void;
  reset(): void;
  /** Ask for the device location, place it on the map, and center the view there. */
  locate(): void;
  /** Re-read garage counts (after a live update) and update the markers in place. */
  refreshGarages(): void;
  /** Dim locations the driver's selected permits do not cover. */
  setPermits(permits: PermitId[], ada: boolean): void;
}

/** Free, no-API-key vector basemap (OpenFreeMap, openfreemap.org) rendered by MapLibre GL JS -
 * a real, Google/Apple-Maps-style map underneath our own VT-specific data layers on top. */
const STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";
/** Labeled at every zoom; chosen to be far enough apart not to collide at full-campus view. */
const LANDMARKS = new Set(["Burruss Hall", "Squires Student Center", "Newman Library", "Lane Stadium", "Cassell Coliseum", "War Memorial Gymnasium"]);
/** Zoom level from which individual (non-ADA) lot pins appear; below it only garages + ADA lots show, decluttering the full-campus view. */
const LOT_DECLUTTER_ZOOM = 16.3;
/** The bottom sheet covers roughly this share of the map view when open. */
const SHEET_FRACTION = 0.45;
const MAX_FIT_ZOOM = 18.5;
const LOAD_TIMEOUT_MS = 9000;

// Same tokens as styles.css's :root (kept in sync by hand - GL paint expressions can't read CSS custom properties).
const CAT_COLOR = CATEGORY_COLOR;
const LOT_FILL = "#c9c3b7";
const LOT_ADA_FILL = "#b9cdf2";
const LOT_LINE = "#9c9384";
const ADA_COLOR = "#0b4fd0";
const GARAGE_FILL = "#3d3036";
const ORANGE = "#e5751f";
const MAROON = "#861f41";
// Permit-filter colors deliberately override the map's category colors so the answer is
// recognizable at a glance, even over a detailed basemap.
const PERMIT_YES = "#008f5a";
const PERMIT_CHECK = "#f2a900";
const PERMIT_NO = "#8d9296";

const EMPTY_FC: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

const key = (kind: string, id: string) => `${kind}:${id}`;

const PERMIT_MARKER_LABEL: Record<LotClass, string> = {
  "any-permit": "Any permit",
  "fs-remote": "F/S Remote",
  "ada-service-24": "ADA 24h",
  "fs-24": "F/S 24h",
  fsv: "F/S + V",
  "perry-fs": "Perry F/S",
  "perry-cg": "Perry C/G",
  cg: "C/G",
  graduate: "Graduate",
  "student-remote": "Student Remote",
};

function permitMarker(classes: LotClass[]): string {
  if (!classes.length) return "";
  return `<span class="m-permit">${esc(classes.map((c) => PERMIT_MARKER_LABEL[c]).join(" / "))}</span>`;
}

function unionBounds(all: [[number, number], [number, number]][]): [[number, number], [number, number]] {
  const lons = all.flatMap((b) => [b[0][0], b[1][0]]);
  const lats = all.flatMap((b) => [b[0][1], b[1][1]]);
  return [
    [Math.min(...lons), Math.min(...lats)],
    [Math.max(...lons), Math.max(...lats)],
  ];
}

function toFeatureCollection<T extends { id: string; footprint: Footprint }>(items: T[], props: (item: T) => Record<string, unknown>): GeoJSON.FeatureCollection {
  return { type: "FeatureCollection", features: items.map((item) => ({ type: "Feature", geometry: footprintToGeoJSON(item.footprint), properties: { id: item.id, ...props(item) } })) };
}

const wheelchairIcon = (cls: string) => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true"><use href="#i-wheelchair"/></svg>`;

const garageLabel = (g: Garage) => {
  const t = garageTotals(g);
  return `${g.name}: ${t.open} of ${t.capacity} spaces open, ${t.adaOpen} accessible open`;
};

function garageMarkerHtml(g: Garage): string {
  const t = garageTotals(g);
  const st = garageStatus(g);
  const count = st === "full" ? "Full" : String(t.open);
  const classes = [...new Set(g.levels.flatMap((level) => level.classes))];
  // .m-inner is what scales with zoom; the pill alone defines the marker's box, so the pin's centre IS the pill's centre (the ADA badge hangs off its right edge)
  return `<span class="m-inner"><span class="m-pill"><span class="m-p">P</span><span class="m-count">${esc(count)}</span></span>
    <span class="m-ada">${wheelchairIcon("m-ada-icon")}<span class="m-ada-count">${t.adaOpen}</span></span>
    ${permitMarker(classes)}</span>`;
}

function lotMarkerHtml(l: Lot): string {
  return `<span class="m-inner"><span class="m-dot">P</span>${l.hasADA ? wheelchairIcon("m-ada-dot") : ""}${permitMarker(l.classes)}</span>`;
}

/** No-op controller returned when the map can't be created at all (e.g. no WebGL2 support), so a
 * broken map never crashes the rest of the app - main.ts keeps working with the list and assistant. */
const NOOP_CONTROLLER: MapController = { setSelection() {}, zoom() {}, reset() {}, locate() {}, refreshGarages() {}, setPermits() {} };

function showMapProblem(el: HTMLElement, message: string) {
  el.innerHTML = `<div class="map-offline"><p>${esc(message)}</p><button type="button" data-retry>Try again</button></div>`;
  el.querySelector("[data-retry]")?.addEventListener("click", () => location.reload());
}

export function createMap(el: HTMLElement, onSelect: (sel: Selection) => void): MapController {
  const homeBounds = unionBounds([...BUILDINGS, ...LOTS, ...GARAGES].map((x) => footprintBounds(x.footprint)));
  // Only in the bundle if actually set up by scripts/build/build.ts; guarded so a non-bundled import (e.g. a future test) never throws.
  if (typeof __MAPLIBRE_WORKER_SRC__ !== "undefined") {
    maplibregl.setWorkerUrl(URL.createObjectURL(new Blob([__MAPLIBRE_WORKER_SRC__], { type: "text/javascript" })));
  }

  let map: maplibregl.Map;
  try {
    map = new maplibregl.Map({
      container: el,
      style: STYLE_URL,
      bounds: homeBounds,
      fitBoundsOptions: { padding: 40 },
      attributionControl: { compact: true },
      dragRotate: false,
      touchPitch: false,
    });
  } catch (err) {
    console.warn("map could not be created", err);
    showMapProblem(el, "This browser can't display the map (WebGL2 is required). Everything else still works.");
    return NOOP_CONTROLLER;
  }

  // Read-only hook for scripts/verify/smoke.mjs (the map has no other externally-inspectable state, since
  // it renders to a single <canvas> rather than one DOM node per feature). Never written to.
  (window as unknown as { __hokiepark_map?: maplibregl.Map }).__hokiepark_map = map;

  const markerEls = new Map<string, HTMLElement>();
  let locationMarker: maplibregl.Marker | undefined;
  let locationStatusTimer: number | undefined;
  let activePermits: PermitId[] = [];
  let activeAda = false;
  let ready = false;
  const pending: (() => void)[] = [];
  const whenReady = (fn: () => void) => (ready ? fn() : void pending.push(fn));

  const timeout = setTimeout(() => {
    if (!ready) showMapProblem(el, "The map needs an internet connection to load.");
  }, LOAD_TIMEOUT_MS);

  map.on("error", (e) => {
    if (ready) return; // a stray tile/glyph error after the map is up is not fatal
    clearTimeout(timeout);
    console.warn("map failed to load", e.error);
    showMapProblem(el, "The map needs an internet connection to load.");
  });

  function addMarker(kind: "garage" | "lot", id: string, lon: number, lat: number, className: string, html: string, ariaLabel: string, onClick: () => void): HTMLElement {
    const div = document.createElement("div");
    div.className = className;
    div.innerHTML = html;
    div.tabIndex = 0;
    div.setAttribute("role", "button");
    div.setAttribute("aria-label", ariaLabel);
    div.dataset.kind = kind;
    div.dataset.id = id;
    // Marker elements sit inside MapLibre's canvas container, so a click here also bubbles into
    // the map's own click handler below (which re-queries whatever's rendered at that pixel and
    // can overwrite this exact selection, sometimes with null). Stop it here, at the source.
    div.addEventListener("click", (e) => {
      e.stopPropagation();
      onClick();
    });
    div.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      e.preventDefault();
      e.stopPropagation();
      onClick();
    });
    new maplibregl.Marker({ element: div, anchor: "center" }).setLngLat([lon, lat]).addTo(map);
    markerEls.set(key(kind, id), div);
    return div;
  }

  map.on("load", () => {
    ready = true;
    clearTimeout(timeout);
    el.removeAttribute("aria-busy");

    // Put all colored geography below the basemap's labels. Street and building names therefore
    // remain readable even when a permit highlight covers the same area.
    const belowLabels = map.getStyle().layers?.find((layer) => layer.type === "symbol")?.id;

    map.addSource("buildings", { type: "geojson", data: toFeatureCollection(BUILDINGS, (b) => ({ category: b.category })) });
    map.addLayer({ id: "buildings-fill", type: "fill", source: "buildings", paint: { "fill-color": ["match", ["get", "category"], "academic", CAT_COLOR.academic, "residential", CAT_COLOR.residential, "support", CAT_COLOR.support, "athletic", CAT_COLOR.athletic, "#999"], "fill-opacity": 0.66 } }, belowLabels);
    map.addLayer({ id: "buildings-outline", type: "line", source: "buildings", paint: { "line-color": "rgba(76,55,62,0.9)", "line-width": 1.4 } }, belowLabels);

    map.addSource("lots", { type: "geojson", data: toFeatureCollection(LOTS, (l) => ({ hasADA: l.hasADA })) });
    map.addLayer({ id: "lots-fill", type: "fill", source: "lots", layout: { visibility: "none" }, paint: { "fill-color": ["case", ["get", "hasADA"], LOT_ADA_FILL, LOT_FILL], "fill-opacity": 0 } }, belowLabels);
    map.addLayer({ id: "lots-outline", type: "line", source: "lots", layout: { visibility: "none" }, paint: { "line-color": ["case", ["get", "hasADA"], ADA_COLOR, LOT_LINE], "line-width": ["case", ["get", "hasADA"], 1.6, 1] } }, belowLabels);

    map.addSource("garages", { type: "geojson", data: toFeatureCollection(GARAGES, () => ({})) });
    map.addLayer({ id: "garages-fill", type: "fill", source: "garages", layout: { visibility: "none" }, paint: { "fill-color": GARAGE_FILL, "fill-opacity": 0 } }, belowLabels);
    map.addLayer({ id: "garages-outline", type: "line", source: "garages", layout: { visibility: "none" }, paint: { "line-color": "#000", "line-width": 1 } }, belowLabels);

    map.addSource("selection", { type: "geojson", data: EMPTY_FC });
    map.addLayer({ id: "selection-outline", type: "line", source: "selection", paint: { "line-color": ORANGE, "line-width": 4 } });

    const labelPoints: GeoJSON.FeatureCollection = {
      type: "FeatureCollection",
      features: [
        { type: "Feature", geometry: { type: "Point", coordinates: [DRILLFIELD_CENTER.lon, DRILLFIELD_CENTER.lat] }, properties: { name: "The Drillfield" } },
        ...BUILDINGS.filter((b) => LANDMARKS.has(b.name)).map((b): GeoJSON.Feature => ({ type: "Feature", geometry: { type: "Point", coordinates: [b.lon, b.lat] }, properties: { name: b.name } })),
      ],
    };
    map.addSource("labels", { type: "geojson", data: labelPoints });
    map.addLayer({ id: "labels-text", type: "symbol", source: "labels", layout: { "text-field": ["get", "name"], "text-font": ["Noto Sans Bold"], "text-size": 12, "text-anchor": "top", "text-offset": [0, 0.4], "text-optional": true }, paint: { "text-color": MAROON, "text-halo-color": "#fff", "text-halo-width": 1.4 } });

    const HIT_LAYERS = ["garages-fill", "buildings-fill", "lots-fill"];
    const KIND_BY_LAYER: Record<string, NonNullable<Selection>["kind"]> = { "garages-fill": "garage", "buildings-fill": "building", "lots-fill": "lot" };
    map.on("click", (e) => {
      const hits = map.queryRenderedFeatures(e.point, { layers: HIT_LAYERS });
      const f = hits[0];
      onSelect(f ? { kind: KIND_BY_LAYER[f.layer.id]!, id: f.properties!.id as string } : null);
    });
    map.on("mousemove", (e) => {
      const hits = map.queryRenderedFeatures(e.point, { layers: HIT_LAYERS });
      map.getCanvas().style.cursor = hits.length ? "pointer" : "";
    });

    // Lots first, garages second: a garage's pill is much wider than a lot's dot, and at the
    // fully-zoomed-out view a lot's fixed-size pin can sit within a nearby garage pill's bounds
    // (both are constant screen size, so real distance shrinks to a few px when zoomed way out).
    // Painting garages last keeps the two garages - fewer, and the more prominent target - on top.
    for (const l of LOTS) {
      const label = `${l.name} lot, ${classSummary(l.classes) || "permit type unknown"}${l.hasADA ? ", accessible parking available" : ""}`;
      addMarker("lot", l.id, l.lon, l.lat, `marker marker-lot${l.hasADA ? " has-ada" : ""}${l.classes.length ? " has-permit-label" : ""}`, lotMarkerHtml(l), label, () => onSelect({ kind: "lot", id: l.id }));
    }
    for (const g of GARAGES) {
      addMarker("garage", g.id, g.center.lon, g.center.lat, `marker marker-garage st-${garageStatus(g)}`, garageMarkerHtml(g), garageLabel(g), () => onSelect({ kind: "garage", id: g.id }));
    }

    const applyDeclutter = () => {
      const z = map.getZoom();
      el.classList.toggle("show-all-lots", z >= LOT_DECLUTTER_ZOOM);
      // pins shrink when zoomed out (so they don't bury the buildings) and grow a little when zoomed in
      el.style.setProperty("--marker-scale", String(markerScale(z)));
    };
    applyDeclutter();
    map.on("zoom", applyDeclutter);

    for (const fn of pending.splice(0)) fn();
  });

  function findFootprint(sel: NonNullable<Selection>): Footprint | undefined {
    if (sel.kind === "garage") return GARAGES.find((g) => g.id === sel.id)?.footprint;
    if (sel.kind === "lot") return LOTS.find((l) => l.id === sel.id)?.footprint;
    return BUILDINGS.find((b) => b.id === sel.id)?.footprint;
  }

  function bottomPadding(): number {
    // Leave at least 100px of vertical room above it - MapLibre warns (and skips fitting) if
    // combined padding leaves no space, which can happen on a very short screen or container.
    return Math.max(0, Math.min(Math.round(el.clientHeight * SHEET_FRACTION), el.clientHeight - 160));
  }

  return {
    setPermits(permits, ada) {
      activePermits = permits;
      activeAda = ada;
      whenReady(() => {
        const on = activePermits.length > 0 || activeAda;
        el.classList.toggle("filtering", on);
        const visibility = on ? "visible" : "none";
        for (const layer of ["lots-fill", "lots-outline", "garages-fill", "garages-outline"]) {
          map.setLayoutProperty(layer, "visibility", visibility);
        }
        const mark = (node: HTMLElement | undefined, verdict: string | null) => {
          if (!node) return;
          node.classList.remove("acc-yes", "acc-no", "acc-check");
          if (verdict) node.classList.add(`acc-${verdict}`);
        };
        for (const l of LOTS) mark(markerEls.get(key("lot", l.id)), on ? lotAccess(l, activePermits, { ada: activeAda }).verdict : null);
        for (const g of GARAGES) mark(markerEls.get(key("garage", g.id)), on ? garageAccess(g.levels, activePermits, { ada: activeAda }).verdict : null);

        (map.getSource("lots") as maplibregl.GeoJSONSource | undefined)?.setData(toFeatureCollection(LOTS, (l) => ({
          hasADA: l.hasADA,
          access: on ? lotAccess(l, activePermits, { ada: activeAda }).verdict : "",
        })));
        (map.getSource("garages") as maplibregl.GeoJSONSource | undefined)?.setData(toFeatureCollection(GARAGES, (g) => ({
          access: on ? garageAccess(g.levels, activePermits, { ada: activeAda }).verdict : "",
        })));
        map.setPaintProperty("lots-fill", "fill-color", on
          ? ["match", ["get", "access"], "yes", PERMIT_YES, "check", PERMIT_CHECK, PERMIT_NO]
          : ["case", ["get", "hasADA"], LOT_ADA_FILL, LOT_FILL]);
        map.setPaintProperty("lots-fill", "fill-opacity", on ? ["match", ["get", "access"], "yes", 0.38, "check", 0.3, 0.02] : 0);
        map.setPaintProperty("lots-outline", "line-color", on
          ? ["match", ["get", "access"], "yes", "#005f3c", "check", "#9b6500", "#666b70"]
          : ["case", ["get", "hasADA"], ADA_COLOR, LOT_LINE]);
        map.setPaintProperty("lots-outline", "line-width", on ? ["match", ["get", "access"], "yes", 3.5, "check", 2.5, 0] : 0);

        map.setPaintProperty("garages-fill", "fill-color", on
          ? ["match", ["get", "access"], "yes", PERMIT_YES, "check", PERMIT_CHECK, PERMIT_NO]
          : GARAGE_FILL);
        map.setPaintProperty("garages-fill", "fill-opacity", on ? ["match", ["get", "access"], "yes", 0.42, "check", 0.34, 0.02] : 0);
        map.setPaintProperty("garages-outline", "line-color", on
          ? ["match", ["get", "access"], "yes", "#005f3c", "check", "#9b6500", "#666b70"]
          : "#000");
        map.setPaintProperty("garages-outline", "line-width", on ? ["match", ["get", "access"], "yes", 4, "check", 3, 0] : 0);
      });
    },
    setSelection(sel, { fly }) {
      whenReady(() => {
        // The List and Ask views hide the map with display:none. Refresh MapLibre's cached canvas
        // dimensions immediately after returning to Map, before fitBounds calculates its padding.
        map.resize();
        for (const n of markerEls.values()) n.classList.remove("is-selected");
        if (!sel) {
          (map.getSource("selection") as maplibregl.GeoJSONSource | undefined)?.setData(EMPTY_FC);
          return;
        }
        markerEls.get(key(sel.kind, sel.id))?.classList.add("is-selected");
        const fp = findFootprint(sel);
        if (!fp) return;
        (map.getSource("selection") as maplibregl.GeoJSONSource | undefined)?.setData(footprintToGeoJSON(fp));
        const bounds = footprintBounds(fp);
        if (fly) {
          map.fitBounds(bounds, { padding: { top: 60, left: 40, right: 40, bottom: bottomPadding() }, maxZoom: MAX_FIT_ZOOM, duration: 600 });
          return;
        }
        // Tapped directly on the map: only reposition if the sheet is about to cover it.
        const center = [(bounds[0][0] + bounds[1][0]) / 2, (bounds[0][1] + bounds[1][1]) / 2] as [number, number];
        const p = map.project(center);
        if (p.y > el.clientHeight * (1 - SHEET_FRACTION) - 30) {
          map.easeTo({ center, padding: { top: 60, left: 40, right: 40, bottom: bottomPadding() }, duration: 400 });
        }
      });
    },
    zoom(factor) {
      whenReady(() => {
        map.resize();
        map.easeTo({ zoom: map.getZoom() + Math.log2(factor), duration: 200 });
      });
    },
    reset() {
      whenReady(() => {
        map.resize();
        map.fitBounds(homeBounds, { padding: 40, duration: 600 });
      });
    },
    locate() {
      whenReady(() => {
        const button = document.getElementById("locate-me");
        const announce = (message: string, state?: "error") => {
          let status = el.querySelector<HTMLElement>(".location-status");
          if (!status) {
            status = document.createElement("div");
            status.className = "location-status";
            status.setAttribute("role", "status");
            el.append(status);
          }
          status.textContent = message;
          status.classList.toggle("is-error", state === "error");
          status.hidden = false;
          if (locationStatusTimer !== undefined) window.clearTimeout(locationStatusTimer);
          locationStatusTimer = window.setTimeout(() => {
            status.hidden = true;
            locationStatusTimer = undefined;
          }, 3500);
        };
        if (!navigator.geolocation) {
          announce("Location is not available in this browser.", "error");
          return;
        }
        button?.classList.add("is-locating");
        navigator.geolocation.getCurrentPosition(
          ({ coords }) => {
            button?.classList.remove("is-locating", "has-error");
            const point: [number, number] = [coords.longitude, coords.latitude];
            if (!locationMarker) {
              const dot = document.createElement("div");
              dot.className = "user-location";
              dot.setAttribute("role", "img");
              dot.setAttribute("aria-label", "Your location");
              locationMarker = new maplibregl.Marker({ element: dot }).setLngLat(point).addTo(map);
            } else {
              locationMarker.setLngLat(point);
            }
            map.easeTo({ center: point, zoom: Math.max(map.getZoom(), 16), duration: 700 });
            announce(`Location found within about ${Math.round(coords.accuracy)} meters.`);
          },
          () => {
            button?.classList.remove("is-locating");
            button?.classList.add("has-error");
            announce("Location access was unavailable. Check your browser permission.", "error");
          },
          { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 },
        );
      });
    },
    refreshGarages() {
      whenReady(() => {
        for (const g of GARAGES) {
          const div = markerEls.get(key("garage", g.id));
          if (!div) continue;
          const t = garageTotals(g);
          const st = garageStatus(g);
          const selected = div.classList.contains("is-selected") ? " is-selected" : "";
          const filtering = activePermits.length > 0 || activeAda;
          const access = filtering ? ` acc-${garageAccess(g.levels, activePermits, { ada: activeAda }).verdict}` : "";
          div.className = withLibraryClasses(div.classList, `marker marker-garage st-${st}${selected}${access}`);
          div.setAttribute("aria-label", garageLabel(g));
          div.innerHTML = garageMarkerHtml(g);
        }
      });
    },
  };
}
