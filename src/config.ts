import type { LiveConfig } from "./lib/live-config.ts";

/** Public Supabase feed config baked in at build time, or null (feed off -> bundled sample counts). */
export const LIVE_CONFIG: LiveConfig | null = typeof __LIVE_CONFIG__ === "undefined" ? null : __LIVE_CONFIG__;
