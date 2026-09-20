export interface SpeechOptions {
  rate?: number;
  voiceURI?: string;
}

export const isSpeechSupported = () => typeof window !== "undefined" && "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;

export function speak(text: string, options: SpeechOptions = {}): boolean {
  if (!isSpeechSupported() || !text.trim()) return false;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = options.rate ?? 1;
  if (options.voiceURI) utterance.voice = window.speechSynthesis.getVoices().find((voice) => voice.voiceURI === options.voiceURI) ?? null;
  window.speechSynthesis.speak(utterance);
  return true;
}

export function pauseSpeech(): void {
  if (isSpeechSupported()) window.speechSynthesis.pause();
}

export function resumeSpeech(): void {
  if (isSpeechSupported()) window.speechSynthesis.resume();
}

export function stopSpeech(): void {
  if (isSpeechSupported()) window.speechSynthesis.cancel();
}
