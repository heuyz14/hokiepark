import type { LiveConfig } from "./live-config.ts";

/** Public config for the optional parking advisor, baked in at build time. Only PUBLIC values: a function URL and the Supabase anon key. */
export interface AdvisorConfig {
  url: string;
  anonKey: string;
}

const ON = new Set(["1", "true", "on", "yes"]);

/**
 * The advisor is opt-in (`HOKIEPARK_ADVISOR=1`) and rides on the Supabase project: its function lives at
 * `<project url>/functions/v1/advisor`. `HOKIEPARK_ADVISOR_URL` overrides the URL (for a local mock or another host).
 * Returns null when off. Throws on a configured-but-invalid value so a typo fails the build instead of silently shipping without it.
 */
export function parseAdvisorConfig(flag: string | undefined, urlOverride: string | undefined, live: LiveConfig | null): AdvisorConfig | null {
  const override = (urlOverride ?? "").trim();
  const on = ON.has((flag ?? "").trim().toLowerCase()) || override !== "";
  if (!on) return null;
  if (!live) throw new Error("The advisor needs the Supabase config: set HOKIEPARK_SUPABASE_URL and HOKIEPARK_SUPABASE_ANON_KEY too.");
  const raw = override || `${live.url.replace(/\/+$/, "")}/functions/v1/advisor`;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error("HOKIEPARK_ADVISOR_URL is not a valid URL.");
  }
  const local = u.hostname === "localhost" || u.hostname === "127.0.0.1";
  if (u.protocol !== "https:" && !(local && u.protocol === "http:")) throw new Error("The advisor URL must be https (http only for localhost).");
  return { url: u.toString(), anonKey: live.anonKey };
}
