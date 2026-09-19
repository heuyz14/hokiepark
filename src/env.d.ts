import type { LiveConfig } from "./lib/live-config.ts";

/** Replaced at build time by scripts/build.ts (esbuild `define`): the validated public feed config, or null. */
declare global {
  const __LIVE_CONFIG__: LiveConfig | null;
  /** Self-contained source of maplibre-gl's worker bundle, embedded so it can run from a Blob URL. */
  const __MAPLIBRE_WORKER_SRC__: string;
}
