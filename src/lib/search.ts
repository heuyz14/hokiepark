import { buildingCodes } from "../data/building-abbreviations.ts";
import type { Building } from "../types.ts";

export interface Searchable {
  name: string;
}

export const normalizeSearch = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

/**
 * Case/punctuation-insensitive match: every whitespace-separated query token must be a
 * substring of the name ("grad west" matches "Graduate Life Center West"; the misspelling
 * "cassel" does not match "Cassell", by design - fuzziness is on the plan's cut list).
 */
export function matches(name: string, query: string): boolean {
  const q = normalizeSearch(query);
  if (!q) return true;
  const n = normalizeSearch(name);
  return q.split(" ").every((t) => n.includes(t));
}

export function filterByName<T extends Searchable>(items: T[], query: string): T[] {
  return items.filter((i) => matches(i.name, query));
}

export function matchesBuilding(building: Building, query: string): boolean {
  const q = normalizeSearch(query);
  return matches(building.name, q) || buildingCodes(building.num).some((code) => normalizeSearch(code).includes(q));
}

export function filterBuildings(buildings: Building[], query: string): Building[] {
  const q = normalizeSearch(query);
  if (!q) return buildings;
  return buildings
    .filter((building) => matchesBuilding(building, q))
    .sort((a, b) => {
      const exactA = buildingCodes(a.num).some((code) => normalizeSearch(code) === q);
      const exactB = buildingCodes(b.num).some((code) => normalizeSearch(code) === q);
      return Number(exactB) - Number(exactA) || a.name.localeCompare(b.name);
    });
}

export function resolveBuilding(buildings: Building[], query: string): Building | null {
  const q = normalizeSearch(query);
  const exactCode = buildings.find((building) => buildingCodes(building.num).some((code) => normalizeSearch(code) === q));
  if (exactCode) return exactCode;
  const exactName = buildings.find((building) => normalizeSearch(building.name) === q);
  if (exactName) return exactName;
  const hits = filterBuildings(buildings, q);
  return hits.length === 1 ? hits[0]! : null;
}

/** Find an official code as a complete phrase inside a natural-language question. */
export function buildingFromText(buildings: Building[], text: string): Building | null {
  const q = ` ${normalizeSearch(text)} `;
  const casePreserved = ` ${text.normalize("NFKD").replace(/[^A-Za-z0-9 ]/g, " ").replace(/\s+/g, " ").trim()} `;
  return buildings.find((building) =>
    buildingCodes(building.num).some((code) => {
      const normalizedCode = normalizeSearch(code);
      return q.trim() === normalizedCode || casePreserved.includes(` ${code} `) || ["at", "in", "near", "to"].some((word) => q.includes(` ${word} ${normalizedCode} `));
    }),
  ) ?? null;
}
