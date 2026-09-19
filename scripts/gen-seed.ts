/** Writes supabase/seed.sql from the bundled sample counts. Run: npm run seed (tests fail if it is stale). */
import { writeFileSync } from "node:fs";
import { SEED_LEVELS } from "../src/data/garages.ts";
import { renderSeedSql } from "../src/lib/seed-sql.ts";

writeFileSync(new URL("../supabase/seed.sql", import.meta.url), renderSeedSql(SEED_LEVELS));
console.log("wrote supabase/seed.sql");
