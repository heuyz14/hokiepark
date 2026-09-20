import assert from "node:assert/strict";
import { test } from "node:test";
import { ACCESSIBILITY_DEFAULTS, loadAccessibilityPreferences, saveAccessibilityPreferences } from "../src/lib/accessibility.ts";

class MemoryStorage {
  private values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

test("accessibility preferences default safely and persist only supported speech rates", () => {
  const storage = new MemoryStorage() as unknown as Storage;
  assert.deepEqual(loadAccessibilityPreferences(storage), ACCESSIBILITY_DEFAULTS);
  saveAccessibilityPreferences({ autoRead: true, speechRate: 1.25, largeText: true, reduceMotion: true }, storage);
  assert.deepEqual(loadAccessibilityPreferences(storage), { autoRead: true, speechRate: 1.25, largeText: true, reduceMotion: true });
  storage.setItem("hokiepark-accessibility-v1", JSON.stringify({ autoRead: true, speechRate: 9 }));
  assert.deepEqual(loadAccessibilityPreferences(storage), { ...ACCESSIBILITY_DEFAULTS, autoRead: true });
  storage.setItem("hokiepark-accessibility-v1", JSON.stringify({ voiceURI: "system-voice" }));
  assert.equal((loadAccessibilityPreferences(storage) as { voiceURI?: string }).voiceURI, "system-voice");
});
