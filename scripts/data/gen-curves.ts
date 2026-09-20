/**
 * Writes supabase/curves.seed.sql from data/raw/timetable.json. Run: npm run curves (tests fail if it is stale).
 * Pipeline: timetable meetings -> building code -> GIS building point -> per-garage class-activity index -> per-level curves.
 * Output is SIMULATED occupancy shaped by seat capacity, not measured data (see src/lib/demand.ts).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { GARAGES } from "../../src/data/garages.ts";
import { buildLevelCurves, coverage, type Placed } from "../../src/lib/demand.ts";
import { renderCurvesSql } from "../../src/lib/curves-sql.ts";
import type { MeetingGroup } from "../../src/lib/timetable.ts";

const read = (p: string) => JSON.parse(readFileSync(new URL(p, import.meta.url), "utf8"));
const timetable = read("../../data/raw/timetable.json") as { term: string; meetings: MeetingGroup[] };
const codes = read("../../data/reference/timetable-building-codes.json") as Record<string, { num: string }>;
const gis = read("../../data/raw/buildings.raw.json").features as { attributes: { bldg_num: string; latitude: number; longitude: number } }[];

const point = new Map<string, { lat: number; lon: number }>();
for (const f of gis) {
  const a = f.attributes;
  if (a.bldg_num && !point.has(a.bldg_num)) point.set(a.bldg_num, { lat: a.latitude, lon: a.longitude });
}

const placed: Placed[] = [];
for (const group of timetable.meetings) {
  const p = codes[group.building] && point.get(codes[group.building]!.num);
  if (p) placed.push({ group, ...p });
}

const cov = coverage(timetable.meetings, (c) => Boolean(codes[c] && point.get(codes[c]!.num)));
console.log(`term ${timetable.term}: placed ${cov.placedSeats}/${cov.totalSeats} weekly seat-meetings (${((100 * cov.placedSeats) / cov.totalSeats).toFixed(1)}%)`);

const curves = buildLevelCurves(placed, GARAGES.map((g) => ({ id: g.id, lat: g.lat, lon: g.lon, levels: g.levels })));
writeFileSync(new URL("../../supabase/curves.seed.sql", import.meta.url), renderCurvesSql(curves));
console.log(`wrote supabase/curves.seed.sql (${curves.length} curves)`);

// Sanity report: hour of peak fill per garage on Tuesday
for (const g of GARAGES) {
  const tue = curves.filter((c) => c.garageId === g.id && c.dow === 2);
  const total = (b: number) => tue.reduce((s, c) => s + (c.pct[b]! * g.levels[c.levelIndex]!.capacity) / 100, 0);
  const cap = g.levels.reduce((s, l) => s + l.capacity, 0);
  const line = [7, 9, 11, 13, 15, 17, 20].map((h) => `${h}:00=${Math.round((100 * total(h * 4)) / cap)}%`).join(" ");
  console.log(`${g.id.padEnd(17)} Tue ${line}`);
}
