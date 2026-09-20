import { test } from "node:test";
import assert from "node:assert/strict";
import { describeSync, refreshInterval, relativeAge, STALE_DATA_MS } from "../src/lib/sync-label.ts";
import type { SyncStatus } from "../src/live.ts";

const NOW = Date.parse("2026-09-19T20:00:00Z");
const live = (dataAgoMs: number, syncAgoMs = 3_000): SyncStatus => ({ state: "live", lastSync: NOW - syncAgoMs, dataAsOf: NOW - dataAgoMs });

test("relativeAge is readable at every scale (never '281m ago')", () => {
  assert.equal(relativeAge(0), "just now");
  assert.equal(relativeAge(9_000), "just now");
  assert.equal(relativeAge(42_000), "42s ago");
  assert.equal(relativeAge(7 * 60_000), "7m ago");
  assert.equal(relativeAge(281 * 60_000), "5h ago");
  assert.equal(relativeAge(47 * 3_600_000), "47h ago");
  assert.equal(relativeAge(72 * 3_600_000), "3d ago");
  assert.equal(relativeAge(-5_000), "just now", "a clock skewed into the future never shows a negative age");
});

test("refreshInterval presents the configured polling cadence compactly", () => {
  assert.equal(refreshInterval(15_000), "15s");
  assert.equal(refreshInterval(60_000), "1m");
  assert.equal(refreshInterval(5 * 60_000), "5m");
});

test("threshold is 12 minutes: comfortably above the 5-minute cron so a healthy feed never warns", () => {
  assert.equal(STALE_DATA_MS, 12 * 60_000);
  assert.ok(STALE_DATA_MS >= 2 * 5 * 60_000, "must tolerate two missed 5-minute ticks");
});

test("data 0-5 minutes old (a healthy 5-minute cron) shows Live with the sync age, tone live", () => {
  for (const mins of [0, 1, 4.9, 5, 6, 11.9]) {
    const l = describeSync(live(mins * 60_000), NOW);
    assert.equal(l.tone, "live", `${mins} min`);
    assert.match(l.text, /^Live · /);
  }
});

test("data older than 12 minutes warns with a readable age", () => {
  const l = describeSync(live(281 * 60_000), NOW);
  assert.equal(l.tone, "warn");
  assert.equal(l.text, "Data 5h ago");
  assert.match(l.title, /simulator may not be running/);
  assert.equal(describeSync(live(12 * 60_000 + 1_000), NOW).tone, "warn");
  assert.equal(describeSync(live(12 * 60_000), NOW).tone, "live", "exactly at the threshold is still fine");
});

test("the other states are unchanged: demo, connecting, offline (with and without a previous sync)", () => {
  assert.deepEqual(describeSync({ state: "demo", lastSync: null, dataAsOf: null }, NOW), { text: "Sample data · no refresh", title: "Showing bundled sample counts. Automatic refresh is off because the live feed is not configured.", tone: "off" });
  assert.equal(describeSync({ state: "connecting", lastSync: null, dataAsOf: null }, NOW, 15_000).text, "Connecting · refresh 15s");
  const never = describeSync({ state: "offline", lastSync: null, dataAsOf: null }, NOW);
  const had = describeSync({ state: "offline", lastSync: NOW - 60_000, dataAsOf: NOW - 60_000 }, NOW, 15_000);
  assert.equal(never.text, "Offline");
  assert.equal(had.text, "Offline · refresh 15s");
  assert.match(never.title, /bundled sample counts/);
  assert.match(had.title, /last known counts/);
  assert.equal(had.tone, "warn");
});

test("a live status with no data timestamp yet shows Live (nothing to be stale about)", () => {
  const label = describeSync({ state: "live", lastSync: NOW - 2_000, dataAsOf: null }, NOW, 15_000);
  assert.equal(label.tone, "live");
  assert.equal(label.text, "Live · just now · refresh 15s");
});
