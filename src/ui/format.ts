import type { BuildingCategory } from "../types.ts";
import { STATUS_LABEL, type AvailabilityStatus } from "../lib/occupancy.ts";

const ESC: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
/** Escape text for interpolation into HTML strings. Every dynamic value goes through this. */
export const esc = (s: string | number): string => String(s).replace(/[&<>"']/g, (c) => ESC[c]!);

export const CATEGORY_LABEL: Record<BuildingCategory, string> = {
  academic: "Academic",
  residential: "Residential & dining",
  support: "Student life & support",
  athletic: "Athletic",
};

/** Fill color per building category: the map layer and the legend both read this, so they cannot drift apart. */
export const CATEGORY_COLOR: Record<BuildingCategory, string> = { academic: "#8b2346", residential: "#86aedb", support: "#cdb891", athletic: "#f4b48a" };

/** Short forms for the legend, where width is tight. */
export const CATEGORY_SHORT: Record<BuildingCategory, string> = {
  academic: "Academic",
  residential: "Residential/dining",
  support: "Student life",
  athletic: "Athletic",
};

export const statusPill = (status: AvailabilityStatus, text?: string) =>
  `<span class="pill pill-${status}">${esc(text ?? STATUS_LABEL[status])}</span>`;

export { formatMeters as meters } from "../lib/nearby.ts";

/**
 * Replace an element's classes with `next` while KEEPING the ones a library added to it. MapLibre puts `maplibregl-marker` on every marker
 * element; that class is what makes it `position: absolute; top: 0; left: 0`. Overwriting `className` wholesale drops it, and the marker then
 * renders at the wrong place (and drifts as the map moves) because the app's own `.marker { position: relative }` takes over.
 */
export function withLibraryClasses(current: Iterable<string>, next: string): string {
  const keep = [...current].filter((c) => c.startsWith("maplibregl-"));
  return [...keep, ...next.split(/\s+/).filter(Boolean)].join(" ");
}

/** Marker size at a map zoom: small when zoomed out (so pins don't bury the buildings), full size around zoom 16, a touch larger beyond. */
export function markerScale(zoom: number): number {
  return Math.round(Math.min(1.1, Math.max(0.68, 0.68 + (zoom - 14) * 0.15)) * 100) / 100;
}
