import type { AdvisorConfig } from "./lib/advisor-config.ts";
import type { LiveConfig } from "./lib/live-config.ts";

/** Public Supabase feed config baked in at build time, or null (feed off -> bundled sample counts). */
export const LIVE_CONFIG: LiveConfig | null = typeof __LIVE_CONFIG__ === "undefined" ? null : __LIVE_CONFIG__;

/** Optional Gemini-backed parking advisor (see docs/GEMINI_NLP_SPEC.md), or null: Ask then uses the rule-based assistant only. */
export const ADVISOR_CONFIG: AdvisorConfig | null = typeof __ADVISOR_CONFIG__ === "undefined" ? null : __ADVISOR_CONFIG__;
