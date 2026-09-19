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
