import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

/** Minimal stand-in for the browser's speech synthesis, recording what was asked of it. */
class FakeUtterance {
  text: string;
  rate = 1;
  voice: unknown = null;
  onboundary: ((e: { charIndex: number }) => void) | null = null;
  onend: (() => void) | null = null;
  constructor(text: string) {
    this.text = text;
  }
}
class FakeSynth {
  spoken: FakeUtterance[] = [];
  cancels = 0;
  paused = false;
  speak(u: FakeUtterance) {
    this.spoken.push(u);
  }
  cancel() {
    this.cancels++;
    // the real API fires onend for the utterance it cancels
    const last = this.spoken[this.spoken.length - 1];
    last?.onend?.();
  }
  pause() { this.paused = true; }
  resume() { this.paused = false; }
  getVoices() { return [{ voiceURI: "test-voice", name: "Test", lang: "en-US", default: true }]; }
}

let synth: FakeSynth;
let speech: typeof import("../src/lib/speech.ts");

beforeEach(async () => {
  synth = new FakeSynth();
  (globalThis as Record<string, unknown>).window = globalThis;
  (globalThis as Record<string, unknown>).speechSynthesis = synth;
  (globalThis as Record<string, unknown>).SpeechSynthesisUtterance = FakeUtterance;
  // fresh module state per test (the module tracks what is currently playing)
  speech = await import(`../src/lib/speech.ts?t=${Math.random()}`);
});

test("speak sends the whole text at the chosen rate", () => {
  assert.equal(speech.speak("First line. Second line. Third line.", { rate: 1.25 }), true);
  assert.equal(synth.spoken.length, 1);
  assert.equal(synth.spoken[0]!.text, "First line. Second line. Third line.");
  assert.equal(synth.spoken[0]!.rate, 1.25);
  assert.equal(speech.isSpeaking(), true);
});

test("empty or blank text is never spoken", () => {
  assert.equal(speech.speak("   "), false);
  assert.equal(synth.spoken.length, 0);
  assert.equal(speech.isSpeaking(), false);
});

test("onEnd fires when the voice finishes by itself", () => {
  let ended = 0;
  speech.speak("all done", { onEnd: () => ended++ });
  synth.spoken[0]!.onend!();
  assert.equal(ended, 1, "the caller must be told so it can restore its controls");
  assert.equal(speech.isSpeaking(), false);
});

test("a deliberate stop is not reported as a finish", () => {
  let ended = 0;
  speech.speak("stop me", { onEnd: () => ended++ });
  speech.stopSpeech();
  assert.equal(ended, 0, "stop already resets the UI; a spurious onEnd would double-handle it");
  assert.equal(speech.isSpeaking(), false);
});

test("changing the rate mid-sentence resumes the remainder at the new speed", () => {
  const text = "Perry Street Garage has three hundred and ten spaces open right now.";
  let ended = 0;
  speech.speak(text, { rate: 1, onEnd: () => ended++ });
  // the browser reports progress as it reads
  synth.spoken[0]!.onboundary!({ charIndex: 20 });

  assert.equal(speech.setSpeechRate(1.5), true);
  assert.equal(ended, 0, "restarting for a new rate is not a finish");
  assert.equal(synth.spoken.length, 2, "the remainder is re-spoken");
  const resumed = synth.spoken[1]!;
  assert.equal(resumed.rate, 1.5);
  assert.equal(resumed.text, text.slice(20), "it picks up where the voice had reached, not from the top");
  assert.ok(!resumed.text.startsWith("Perry"), "must not repeat what was already read");
});

test("changing the rate with nothing playing just reports false", () => {
  assert.equal(speech.setSpeechRate(1.5), false);
  assert.equal(synth.spoken.length, 0);
});

test("the new rate sticks for the rest of the response", () => {
  speech.speak("one two three four five six", { rate: 1 });
  synth.spoken[0]!.onboundary!({ charIndex: 4 });
  speech.setSpeechRate(0.75);
  synth.spoken[1]!.onboundary!({ charIndex: 4 });
  speech.setSpeechRate(0.75);
  assert.equal(synth.spoken[2]!.rate, 0.75);
});

test("pause and resume pass through", () => {
  speech.speak("hello");
  speech.pauseSpeech();
  assert.equal(synth.paused, true);
  speech.resumeSpeech();
  assert.equal(synth.paused, false);
});
