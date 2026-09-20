import type { LiveConfig } from "./lib/live-config.ts";
import type { AdvisorConfig } from "./lib/advisor-config.ts";

/** Replaced at build time by scripts/build/build.ts (esbuild `define`): the validated public feed config, or null. */
declare global {
  const __LIVE_CONFIG__: LiveConfig | null;
  /** Replaced at build time: the optional parking-advisor function URL + anon key, or null (advisor off). */
  const __ADVISOR_CONFIG__: AdvisorConfig | null;
  /** Self-contained source of maplibre-gl's worker bundle, embedded so it can run from a Blob URL. */
  const __MAPLIBRE_WORKER_SRC__: string;
}
