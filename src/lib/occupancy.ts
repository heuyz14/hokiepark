import type { Garage, GarageLevel, Lot } from "../types.ts";
import { classSummary } from "./permits.ts";

/**
 * Occupancy rules. Everything the UI or the AI assistant prints about open spaces must go
 * through these helpers so the numbers cannot disagree between map, list, sheet and chat
 * (Phase 5, step 1). `capacity` includes the ADA spaces; `adaCapacity` is the ADA subset.
 */
export type AvailabilityStatus = "open" | "limited" | "full";

export const openSpaces = (l: Pick<GarageLevel, "capacity" | "occupied">) => Math.max(0, l.capacity - l.occupied);
export const openAdaSpaces = (l: Pick<GarageLevel, "adaCapacity" | "adaOccupied">) => Math.max(0, l.adaCapacity - l.adaOccupied);

export function garageTotals(g: Garage) {
  const capacity = g.levels.reduce((s, l) => s + l.capacity, 0);
  const occupied = g.levels.reduce((s, l) => s + l.occupied, 0);
  const adaCapacity = g.levels.reduce((s, l) => s + l.adaCapacity, 0);
  const adaOccupied = g.levels.reduce((s, l) => s + l.adaOccupied, 0);
  return {
    capacity,
    occupied,
    open: Math.max(0, capacity - occupied),
    adaCapacity,
    adaOpen: Math.max(0, adaCapacity - adaOccupied),
  };
}

/** Fullness thresholds: full at 0 open; limited below 10% open. */
export function availability(open: number, capacity: number): AvailabilityStatus {
  if (capacity <= 0 || open <= 0) return "full";
  return open / capacity < 0.1 ? "limited" : "open";
}

export const STATUS_LABEL: Record<AvailabilityStatus, string> = { open: "Open", limited: "Limited", full: "Full" };

export const garageStatus = (g: Garage) => {
  const t = garageTotals(g);
  return availability(t.open, t.capacity);
};

export const levelStatus = (l: GarageLevel) => availability(openSpaces(l), l.capacity);

/** Human summary used verbatim by the list view and the AI context. */
export function garageSummary(g: Garage): string {
  const t = garageTotals(g);
  return `${t.open} of ${t.capacity} open, ${t.adaOpen} accessible open`;
}

export function lotSummary(l: Lot): string {
  const who = classSummary(l.classes);
  return l.hasADA ? `${who} - ADA parking available` : who;
}
