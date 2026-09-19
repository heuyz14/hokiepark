import type { Garage, GarageLevel } from "../types.ts";
import type { LiveConfig } from "./live-config.ts";

/**
 * Remote occupancy: fetch rows from the Supabase `garage_levels` table, validate every field (the response is
 * untrusted input), and apply them onto the in-memory GARAGES. Applying is all-or-nothing: one bad row rejects
 * the whole payload so the UI never shows a half-updated, inconsistent garage.
 */
export interface OccupancyRow {
  garage_id: string;
  level_index: number;
  label: string;
  capacity: number;
  occupied: number;
  ada_capacity: number;
  ada_occupied: number;
  updated_at: string;
}

const isInt = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n);
const inRange = (n: unknown, lo: number, hi: number): n is number => isInt(n) && n >= lo && n <= hi;

export function parseOccupancyRows(json: unknown): OccupancyRow[] {
  if (!Array.isArray(json)) throw new Error("occupancy response is not an array");
  if (json.length > 500) throw new Error("occupancy response is unexpectedly large");
  const seen = new Set<string>();
  return json.map((raw, i): OccupancyRow => {
    const at = `row ${i}`;
    if (typeof raw !== "object" || raw === null) throw new Error(`${at}: not an object`);
    const r = raw as Record<string, unknown>;
    if (typeof r.garage_id !== "string" || !/^[a-z0-9-]{1,64}$/.test(r.garage_id)) throw new Error(`${at}: bad garage_id`);
    if (!inRange(r.level_index, 0, 99)) throw new Error(`${at}: bad level_index`);
    if (typeof r.label !== "string" || r.label.length < 1 || r.label.length > 80) throw new Error(`${at}: bad label`);
    if (!inRange(r.capacity, 1, 5000)) throw new Error(`${at}: bad capacity`);
    if (!inRange(r.occupied, 0, r.capacity)) throw new Error(`${at}: occupied out of range`);
    if (!inRange(r.ada_capacity, 0, r.capacity)) throw new Error(`${at}: ada_capacity out of range`);
    if (!inRange(r.ada_occupied, 0, Math.min(r.ada_capacity, r.occupied))) throw new Error(`${at}: ada_occupied out of range`);
    if (typeof r.updated_at !== "string" || Number.isNaN(Date.parse(r.updated_at))) throw new Error(`${at}: bad updated_at`);
    const key = `${r.garage_id}#${r.level_index}`;
    if (seen.has(key)) throw new Error(`${at}: duplicate level ${key}`);
    seen.add(key);
    return { garage_id: r.garage_id, level_index: r.level_index, label: r.label, capacity: r.capacity, occupied: r.occupied, ada_capacity: r.ada_capacity, ada_occupied: r.ada_occupied, updated_at: r.updated_at };
  });
}

const toLevel = (r: OccupancyRow): GarageLevel => ({ label: r.label, capacity: r.capacity, occupied: r.occupied, adaCapacity: r.ada_capacity, adaOccupied: r.ada_occupied });

/**
 * Replace levels on every garage that has rows. Returns whether anything changed (so the UI can skip a
 * re-render). Throws if NO row matched a known garage: that means the wrong table/project, not "no news".
 */
export function applyOccupancy(garages: Garage[], rows: OccupancyRow[]): boolean {
  const by = new Map<string, OccupancyRow[]>();
  for (const r of rows) (by.get(r.garage_id) ?? by.set(r.garage_id, []).get(r.garage_id)!).push(r);
  const known = garages.filter((g) => by.has(g.id));
  if (!known.length) throw new Error("occupancy rows matched no known garage");
  let changed = false;
  for (const g of known) {
    const levels = by.get(g.id)!.sort((a, b) => a.level_index - b.level_index).map(toLevel);
    if (JSON.stringify(levels) !== JSON.stringify(g.levels)) {
      g.levels = levels;
      changed = true;
    }
  }
  return changed;
}

/** Newest `updated_at` among rows, in epoch ms (0 if none). */
export const latestUpdate = (rows: OccupancyRow[]) => rows.reduce((m, r) => Math.max(m, Date.parse(r.updated_at)), 0);

const SELECT = "garage_id,level_index,label,capacity,occupied,ada_capacity,ada_occupied,updated_at";

export async function fetchOccupancy(cfg: LiveConfig, fetchImpl: typeof fetch = fetch): Promise<OccupancyRow[]> {
  const headers: Record<string, string> = { apikey: cfg.anonKey, Accept: "application/json" };
  // Legacy anon keys are JWTs and go in Authorization too; new-style publishable keys are not JWTs and must not.
  if (cfg.anonKey.startsWith("eyJ")) headers.Authorization = `Bearer ${cfg.anonKey}`;
  const res = await fetchImpl(`${cfg.url}/rest/v1/garage_levels?select=${SELECT}&order=garage_id.asc,level_index.asc`, {
    headers,
    cache: "no-store",
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`occupancy request failed: HTTP ${res.status}`);
  return parseOccupancyRows(await res.json());
}
