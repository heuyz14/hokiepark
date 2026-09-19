import type { Building } from "../types.ts";
import buildings from "./buildings.json" with { type: "json" };

export const BUILDINGS = buildings as Building[];
