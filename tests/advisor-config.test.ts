import { test } from "node:test";
import assert from "node:assert/strict";
import { parseAdvisorConfig } from "../src/lib/advisor-config.ts";
import type { LiveConfig } from "../src/lib/live-config.ts";

const live: LiveConfig = { url: "https://abc.supabase.co/", anonKey: "sb_publishable_x", pollMs: 15000 };

test("off unless opted in", () => {
  assert.equal(parseAdvisorConfig(undefined, undefined, live), null);
  assert.equal(parseAdvisorConfig("", "", live), null);
  assert.equal(parseAdvisorConfig("0", undefined, live), null);
  assert.equal(parseAdvisorConfig("no", undefined, null), null, "off is fine without Supabase");
});

test("on: derives the function URL from the Supabase project and reuses the public anon key", () => {
  for (const flag of ["1", "true", "ON", " yes "]) {
    assert.deepEqual(parseAdvisorConfig(flag, undefined, live), { url: "https://abc.supabase.co/functions/v1/advisor", anonKey: "sb_publishable_x" });
  }
});

test("an override URL wins (https, or http on localhost) and enables the advisor by itself", () => {
  assert.equal(parseAdvisorConfig(undefined, "http://localhost:9999/advisor", live)!.url, "http://localhost:9999/advisor");
  assert.equal(parseAdvisorConfig("1", "https://example.com/fn", live)!.url, "https://example.com/fn");
});

test("misconfiguration fails loudly: needs Supabase, valid URL, https", () => {
  assert.throws(() => parseAdvisorConfig("1", undefined, null), /needs the Supabase config/);
  assert.throws(() => parseAdvisorConfig("1", "not a url", live), /not a valid URL/);
  assert.throws(() => parseAdvisorConfig("1", "http://example.com/fn", live), /must be https/);
});
