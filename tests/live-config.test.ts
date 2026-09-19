import { test } from "node:test";
import assert from "node:assert/strict";
import { assertPublicKey, parseLiveConfig } from "../src/lib/live-config.ts";

const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = (role: string) => `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ role, iss: "supabase" })}.sig`;

test("unconfigured (both empty/undefined) means the feed is off, not an error", () => {
  assert.equal(parseLiveConfig(undefined, undefined), null);
  assert.equal(parseLiveConfig("", "  "), null);
});

test("valid config is normalized to the URL origin with the default poll interval", () => {
  const c = parseLiveConfig("https://abcd.supabase.co/", jwt("anon"))!;
  assert.equal(c.url, "https://abcd.supabase.co");
  assert.equal(c.pollMs, 15000);
  assert.equal(parseLiveConfig("https://abcd.supabase.co", "sb_publishable_x", "2000")!.pollMs, 2000);
});

test("a half-configured feed fails loudly instead of silently shipping demo data", () => {
  assert.throws(() => parseLiveConfig("https://abcd.supabase.co", ""), /BOTH/);
  assert.throws(() => parseLiveConfig("", jwt("anon")), /BOTH/);
});

test("rejects non-https remote URLs, allows http only for localhost", () => {
  assert.throws(() => parseLiveConfig("http://abcd.supabase.co", jwt("anon")), /https/);
  assert.throws(() => parseLiveConfig("not a url", jwt("anon")), /valid URL/);
  assert.equal(parseLiveConfig("http://127.0.0.1:54321", jwt("anon"))!.url, "http://127.0.0.1:54321");
});

test("SECURITY: a service_role JWT or sb_secret_ key can never be embedded", () => {
  assert.throws(() => assertPublicKey(jwt("service_role")), /service_role/);
  assert.throws(() => assertPublicKey("sb_secret_abc123"), /SECRET/);
  assert.throws(() => parseLiveConfig("https://abcd.supabase.co", jwt("service_role")), /service_role/);
  assert.doesNotThrow(() => assertPublicKey(jwt("anon")));
  assert.doesNotThrow(() => assertPublicKey("sb_publishable_abc"));
});

test("poll interval must be a sane number", () => {
  assert.throws(() => parseLiveConfig("https://a.supabase.co", jwt("anon"), "10"), /POLL_MS/);
  assert.throws(() => parseLiveConfig("https://a.supabase.co", jwt("anon"), "abc"), /POLL_MS/);
});
