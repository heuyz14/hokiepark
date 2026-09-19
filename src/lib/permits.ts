import type { Garage, GarageLevel, Lot, PermitType } from "../types.ts";
import { availability, openSpaces, type AvailabilityStatus } from "./occupancy.ts";

/**
 * Permit eligibility (DEMO rules). Lot `permit` values and garage level labels are hand-set demo data
 * (VT's GIS has no permit field), so this filter shows what the demo data says, not VT's official rules.
 * Accessible (ADA) parking is deliberately independent of permit: it is never dimmed or filtered here.
 */
export type PermitChoice = "commuter" | "resident" | "faculty" | "visitor";
export const PERMIT_CHOICES: PermitChoice[] = ["commuter", "resident", "faculty", "visitor"];
export const PERMIT_LABEL: Record<PermitChoice, string> = { commuter: "Commuter", resident: "Resident", faculty: "Faculty/Staff", visitor: "Visitor" };

/** Validate untrusted input (localStorage, <select> value, URL): anything unknown becomes null ("any permit"). */
export const parsePermitChoice = (raw: unknown): PermitChoice | null =>
  typeof raw === "string" && (PERMIT_CHOICES as string[]).includes(raw) ? (raw as PermitChoice) : null;

const LOT_PERMIT: Record<PermitType, PermitChoice | "all"> = {
  Commuter: "commuter",
  Resident: "resident",
  "Faculty/Staff": "faculty",
  Visitor: "visitor",
  Mixed: "all",
};

export const lotAllows = (lot: Pick<Lot, "permit">, p: PermitChoice): boolean => {
  const need = LOT_PERMIT[lot.permit];
  return need === "all" || need === p;
};

/** Grey out a lot for a permit, except ADA lots: accessible parking is never hidden by permit. */
export const lotDimmed = (lot: Pick<Lot, "permit" | "hasADA">, p: PermitChoice | null): boolean => !!p && !lot.hasADA && !lotAllows(lot, p);

/** Permits a garage level accepts, parsed from its label ("Commuter & graduate", "Faculty, staff & visitor"). */
export function levelPermits(level: Pick<GarageLevel, "label">): PermitChoice[] {
  const l = level.label.toLowerCase();
  const out: PermitChoice[] = [];
  if (/commuter|graduate/.test(l)) out.push("commuter");
  if (/faculty|staff/.test(l)) out.push("faculty");
  if (/visitor/.test(l)) out.push("visitor");
  if (/resident/.test(l)) out.push("resident");
  return out.length ? out : [...PERMIT_CHOICES]; // an unlabeled level is treated as unrestricted
}

export const levelAllows = (level: Pick<GarageLevel, "label">, p: PermitChoice) => levelPermits(level).includes(p);
export const eligibleLevels = (g: Garage, p: PermitChoice) => g.levels.filter((l) => levelAllows(l, p));
/** Open regular spaces on the levels this permit may use (ADA counts are separate and unfiltered). */
export const eligibleOpen = (g: Garage, p: PermitChoice) => eligibleLevels(g, p).reduce((n, l) => n + openSpaces(l), 0);

/** Question text -> permit, for the assistant ("I have a commuter permit", "faculty parking", "where can visitors park"). */
export function detectPermit(normalizedQuestion: string): PermitChoice | null {
  const q = normalizedQuestion;
  if (/\b(commuter|commuters|commute|commuting)\b/.test(q)) return "commuter";
  if (/\b(resident|residents|dorm|dorms)\b/.test(q)) return "resident";
  if (/\b(faculty|staff|professor|employee|employees)\b/.test(q)) return "faculty";
  if (/\b(visitor|visitors|guest|guests|tour|visiting)\b/.test(q)) return "visitor";
  return null;
}

/** Open/Limited/Full for the levels this permit may use (Full if there are none), for "Full for you" style labels. */
export function eligibleStatus(g: Garage, p: PermitChoice): AvailabilityStatus {
  const ls = eligibleLevels(g, p);
  return availability(ls.reduce((n, l) => n + openSpaces(l), 0), ls.reduce((n, l) => n + l.capacity, 0));
}
