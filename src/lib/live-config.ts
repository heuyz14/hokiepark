/**
 * Runtime config for the optional Supabase-backed occupancy feed. Pure functions so the build script and the
 * browser share one validator. Only PUBLIC values ever reach the bundle: the project URL and the anon /
 * publishable key (safe by design, protected by RLS). A service-role / secret key must never be embedded.
 */
export interface LiveConfig {
  url: string;
  anonKey: string;
  pollMs: number;
}

export const DEFAULT_POLL_MS = 60_000; // one minute: the server-side simulator only advances once a minute, so polling faster just re-reads the same rows
export const MIN_POLL_MS = 1_000;

function jwtRole(key: string): string | null {
  const parts = key.split(".");
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(atob(parts[1]!.replace(/-/g, "+").replace(/_/g, "/"))) as { role?: unknown };
    return typeof payload.role === "string" ? payload.role : null;
  } catch {
    return null;
  }
}

/** Throws if the key is a privileged (service-role / secret) key. Used at build time as a hard stop. */
export function assertPublicKey(key: string): void {
  if (key.startsWith("sb_secret_")) throw new Error("Refusing to embed a Supabase SECRET key in the browser bundle. Use the anon/publishable key.");
  if (jwtRole(key) === "service_role") throw new Error("Refusing to embed a Supabase service_role key in the browser bundle. Use the anon key.");
}

/**
 * Returns a validated config, or null when the feed is not configured (empty values). Throws on a
 * configured-but-invalid value so a typo fails the build loudly instead of silently shipping demo data.
 */
export function parseLiveConfig(url: string | undefined, anonKey: string | undefined, pollMs?: string): LiveConfig | null {
  const u = (url ?? "").trim();
  const k = (anonKey ?? "").trim();
  if (!u && !k) return null;
  if (!u || !k) throw new Error("Set BOTH HOKIEPARK_SUPABASE_URL and HOKIEPARK_SUPABASE_ANON_KEY (or neither).");
  let parsed: URL;
  try {
    parsed = new URL(u);
  } catch {
    throw new Error("HOKIEPARK_SUPABASE_URL is not a valid URL.");
  }
  const local = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
  if (parsed.protocol !== "https:" && !(local && parsed.protocol === "http:")) throw new Error("HOKIEPARK_SUPABASE_URL must be https (http only for localhost).");
  assertPublicKey(k);
  const poll = pollMs?.trim() ? Number(pollMs) : DEFAULT_POLL_MS;
  if (!Number.isFinite(poll) || poll < MIN_POLL_MS) throw new Error(`HOKIEPARK_POLL_MS must be a number >= ${MIN_POLL_MS}.`);
  return { url: parsed.origin, anonKey: k, pollMs: Math.round(poll) };
}
