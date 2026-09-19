import type { GarageLevel } from "../types.ts";
import type { OccupancyRow } from "./occupancy-remote.ts";

export interface SeedDrift {
  /** Names differ. Harmless: the app uses its own labels (signage is code). */
  labels: string[];
  /** Sizes differ. NOT harmless: the app takes capacity from the database, so the live view shows the wrong garage size. */
  capacities: string[];
}

/**
 * Compare the database rows with the bundled seed (src/data/garages.ts). Used by `npm run check:supabase` so a
 * database that was seeded before the code changed is reported instead of silently showing stale numbers.
 * Only levels present in BOTH sides are compared; a missing level is reported separately by the script.
 */
export function findSeedDrift(rows: OccupancyRow[], seed: Record<string, GarageLevel[]>): SeedDrift {
  const labels: string[] = [];
  const capacities: string[] = [];
  for (const [garageId, levels] of Object.entries(seed)) {
    levels.forEach((l, i) => {
      const r = rows.find((x) => x.garage_id === garageId && x.level_index === i);
      if (!r) return;
      const at = `${garageId} L${i + 1}`;
      if (r.label !== l.label) labels.push(`${at}: database "${r.label}" vs app "${l.label}"`);
      if (r.capacity !== l.capacity || r.ada_capacity !== l.adaCapacity) {
        capacities.push(`${at}: database ${r.capacity} spaces (${r.ada_capacity} accessible) vs app ${l.capacity} (${l.adaCapacity})`);
      }
    });
  }
  return { labels, capacities };
}
