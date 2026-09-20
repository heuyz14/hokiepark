export interface SpeechOptions {
  rate?: number;
  voiceURI?: string;
  /** Called when the utterance finishes on its own, so the caller can put its controls back. */
  onEnd?: () => void;
}

export const isSpeechSupported = () => typeof window !== "undefined" && "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;

/**
 * The Web Speech API fixes an utterance's rate when it starts: changing `rate` on a speaking
 * utterance does nothing. To let someone speed up a response they are already listening to, we
 * remember the text, the options, and how far through it the browser has read, then re-speak the
 * remainder at the new rate. `restarting` suppresses the cancel-triggered `onend` so the caller
 * does not see a real finish.
 */
let current: { text: string; offset: number; options: SpeechOptions } | null = null;
let restarting = false;

function play(text: string, from: number, options: SpeechOptions): void {
  const utterance = new SpeechSynthesisUtterance(text.slice(from));
  utterance.rate = options.rate ?? 1;
  if (options.voiceURI) utterance.voice = window.speechSynthesis.getVoices().find((voice) => voice.voiceURI === options.voiceURI) ?? null;
  utterance.onboundary = (event: SpeechSynthesisEvent) => {
    if (current) current.offset = from + (event.charIndex ?? 0);
  };
  utterance.onend = () => {
    if (restarting) return;
    current = null;
    options.onEnd?.();
  };
  window.speechSynthesis.speak(utterance);
}

export function speak(text: string, options: SpeechOptions = {}): boolean {
  if (!isSpeechSupported() || !text.trim()) return false;
  restarting = true;
  window.speechSynthesis.cancel();
  restarting = false;
  current = { text, offset: 0, options };
  play(text, 0, options);
  return true;
}

/** True while something is queued or speaking, so the UI can show pause/stop instead of "read aloud". */
export const isSpeaking = (): boolean => current !== null;

/**
 * Apply a new rate immediately, picking up roughly where the voice had reached. Returns false when
 * nothing is playing, in which case the caller only needs to remember the rate for next time.
 */
export function setSpeechRate(rate: number): boolean {
  if (!isSpeechSupported() || !current) return false;
  const { text, offset, options } = current;
  const next = { ...options, rate };
  restarting = true;
  window.speechSynthesis.cancel();
  restarting = false;
  current = { text, offset, options: next };
  play(text, offset, next);
  return true;
}

export function pauseSpeech(): void {
  if (isSpeechSupported()) window.speechSynthesis.pause();
}

export function resumeSpeech(): void {
  if (isSpeechSupported()) window.speechSynthesis.resume();
}

export function stopSpeech(): void {
  if (!isSpeechSupported()) return;
  restarting = true; // a deliberate stop is not a finish; the caller resets its own controls
  window.speechSynthesis.cancel();
  restarting = false;
  current = null;
}
