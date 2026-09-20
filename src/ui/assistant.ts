import type { Answer, AnswerRef, Answerer } from "../lib/assistant.ts";
import { followUpQuestions, SUGGESTED_QUESTIONS } from "../lib/assistant.ts";
import { ADVISOR_SUGGESTIONS, ADVISOR_TOOL_LABELS, type AdvisorAnswer, type AdvisorMapAction, type AdvisorToolEvent } from "../lib/advisor.ts";
import { isSpeechSupported, pauseSpeech, resumeSpeech, speak, stopSpeech } from "../lib/speech.ts";
import { applyAccessibilityPreferences, loadAccessibilityPreferences, saveAccessibilityPreferences, type AccessibilityPreferences } from "../lib/accessibility.ts";
import type { Selection } from "../types.ts";
import { esc } from "./format.ts";

export interface AssistantOptions {
  answer: Answerer;
  onSelect: (sel: Selection) => void;
  /** True when the Gemini-backed advisor is wired in: changes the greeting, suggestions and answer badges. */
  advisor?: boolean;
  /** Permission is still requested by the normal map/browser flow; no coordinates reach this component. */
  ensureCurrentLocation?: () => Promise<boolean>;
  subscribeActivity?: (listener: (event: AdvisorToolEvent) => void) => () => void;
  onMapAction?: (action: AdvisorMapAction) => void;
}

const bubbleLines = (lines: string[]) =>
  lines.map((l) => (l.startsWith("- ") ? `<span class="li">${esc(l.slice(2))}</span>` : `<span class="ln">${esc(l)}</span>`)).join("");

/** Which engine answered, shown only when the advisor is on (so the fallback is never silent). */
const REASON_TEXT: Record<string, string> = { transport: "AI unavailable", timeout: "AI too slow", guard: "AI answer rejected", rounds: "AI couldn't finish", empty: "AI had no answer", input: "" };
const sourceTag = (a: AdvisorAnswer, advisor: boolean) =>
  !advisor
    ? ""
    : a.source === "ai"
      ? `<span class="src src-ai" title="Understood by a hosted AI model; all facts from HokiePark's tools">AI advisor</span>`
      : `<span class="src src-basic" title="The advisor was unavailable${a.reason ? ` (${esc(a.reason)})` : ""}; this is the built-in rule-based answer">Basic answer${a.reason && REASON_TEXT[a.reason] ? ` &middot; ${esc(REASON_TEXT[a.reason]!)}` : ""}</span>`;

const refButtons = (refs: AnswerRef[]) =>
  refs.length
    ? `<div class="refs">${refs.map((r) => `<button type="button" class="ref" data-kind="${r.kind}" data-id="${esc(r.id)}">Show ${esc(r.label)} on map</button>`).join("")}</div>`
    : "";

const chipRow = (questions: string[]) =>
  questions.length
    ? `<div class="followups"><p class="followups-cap">Ask next</p>${questions.map((q) => `<button type="button" class="chip">${esc(q)}</button>`).join("")}</div>`
    : "";

const agentActivity = (answer: AdvisorAnswer, advisor: boolean) => {
  if (!advisor || answer.source !== "ai" || !answer.tools?.length) return "";
  const tools = answer.tools.map((tool) => `<li class="agent-event ${tool.ok ? "ok" : "error"}">${tool.ok ? "✓" : "!"} ${esc(ADVISOR_TOOL_LABELS[tool.name] ?? tool.name)}</li>`).join("");
  return `<details class="agent-activity"><summary>HokiePark agent activity</summary><ul>${tools}</ul></details>`;
};

const speechControls = () =>
  isSpeechSupported()
    ? `<div class="speech-controls"><button type="button" class="speech-read" aria-label="Read this response aloud">🔊 Read aloud</button><span class="speech-active" hidden><button type="button" class="speech-toggle" aria-label="Pause spoken response">⏸ Pause</button><button type="button" class="speech-stop" aria-label="Stop spoken response">■ Stop</button></span></div>`
    : "";

type Recognition = { start(): void; stop(): void; abort(): void; onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null; onend: (() => void) | null; onerror: (() => void) | null; continuous: boolean; interimResults: boolean; lang: string };
type RecognitionCtor = new () => Recognition;
const recognitionCtor = (): RecognitionCtor | undefined => (window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor }).SpeechRecognition ?? (window as unknown as { webkitSpeechRecognition?: RecognitionCtor }).webkitSpeechRecognition;
const microphoneGlyph = "🎤";
const stopGlyph = "■";

const activityList = (events: AdvisorToolEvent[]) => events.length ? `<details class="agent-activity" open><summary>HokiePark agent activity</summary><ul>${events.map((event) => `<li class="agent-event ${event.status === "error" ? "error" : event.status === "success" ? "ok" : "running"}">${event.status === "success" ? "✓" : event.status === "error" ? "!" : "…"} ${esc(event.label)}</li>`).join("")}</ul></details>` : "";
const mapActions = (actions: AdvisorMapAction[] | undefined) => actions?.some((action) => action.type === "show_route") ? `<div class="refs"><button type="button" class="advisor-route">Show walking route on map</button></div>` : "";

export function createAssistant(el: HTMLElement, { answer, onSelect, advisor = false, ensureCurrentLocation, subscribeActivity, onMapAction }: AssistantOptions): void {
  // Keep the cold-start surface focused; follow-up suggestions still provide more paths after an answer.
  const suggestionPool = advisor ? ADVISOR_SUGGESTIONS : SUGGESTED_QUESTIONS;
  const suggestions = suggestionPool.slice(0, 1);
  el.innerHTML = `
    <div class="chat">
      <div class="chat-log" id="chat-log" role="log" aria-live="polite" aria-relevant="additions"></div>
      <div class="chat-suggest" id="chat-suggest">
        ${suggestions.map((q) => `<button type="button" class="chip">${esc(q)}</button>`).join("")}
      </div>
      <form class="chat-form" id="chat-form" autocomplete="off">
        <label for="chat-q" class="sr-only">Ask a parking question</label>
        <div class="chat-composer">
          <textarea id="chat-q" rows="3" placeholder="${advisor ? "Describe your class, destination, time, or parking question..." : "Ask a parking question..."}" enterkeyhint="send" maxlength="300"></textarea>
          <div class="composer-actions"><button type="button" class="mic" aria-label="Start voice input" title="Start voice input" hidden><span aria-hidden="true">${microphoneGlyph}</span></button><button type="submit" class="send" aria-label="Send parking question">Send</button></div>
        </div>
      </form>
      <details class="accessibility-settings"><summary>Accessibility &amp; voice</summary><div class="accessibility-options"><label><input type="checkbox" data-a11y="autoRead"> Read responses aloud automatically</label><fieldset><legend>Speech speed</legend><div class="speech-rates"><label><input type="radio" name="speech-rate" value="0.75">0.75x</label><label><input type="radio" name="speech-rate" value="1">1x</label><label><input type="radio" name="speech-rate" value="1.25">1.25x</label><label><input type="radio" name="speech-rate" value="1.5">1.5x</label></div></fieldset><label>Voice <select data-a11y="voiceURI"><option value="">System Default</option></select></label><label><input type="checkbox" data-a11y="largeText"> Larger interface text</label><label><input type="checkbox" data-a11y="reduceMotion"> Reduce motion</label></div></details>
    </div>`;
  const log = el.querySelector<HTMLElement>("#chat-log")!;
  const suggest = el.querySelector<HTMLElement>("#chat-suggest")!;
  const form = el.querySelector<HTMLFormElement>("#chat-form")!;
  const input = el.querySelector<HTMLTextAreaElement>("#chat-q")!;
  const send = el.querySelector<HTMLButtonElement>(".send")!;
  const mic = el.querySelector<HTMLButtonElement>(".mic")!;
  const Recognition = recognitionCtor();
  let recognition: Recognition | null = null;
  const setMicState = (recording: boolean) => {
    mic.classList.toggle("is-recording", recording);
    mic.setAttribute("aria-label", recording ? "Stop voice input" : "Start voice input");
    mic.title = recording ? "Recording — tap to stop" : "Start voice input";
    mic.innerHTML = `<span aria-hidden="true">${recording ? stopGlyph : microphoneGlyph}</span>`;
  };
  if (Recognition) {
    mic.hidden = false;
    mic.addEventListener("click", () => {
      if (recognition) { recognition.abort(); return; }
      recognition = new Recognition();
      recognition.continuous = false;
      recognition.interimResults = false;
      recognition.lang = navigator.language || "en-US";
      setMicState(true);
      recognition.onresult = (event) => {
        input.value = Array.from(event.results).map((result) => result[0]?.transcript ?? "").join(" ").trim();
        resizeComposer();
        input.focus(); // transcript is deliberately editable and never submitted automatically
      };
      recognition.onend = recognition.onerror = () => {
        recognition = null;
        setMicState(false);
      };
      try { recognition.start(); } catch { recognition = null; setMicState(false); }
    });
  }
  let preferences: AccessibilityPreferences = loadAccessibilityPreferences();
  applyAccessibilityPreferences(preferences);
  for (const control of el.querySelectorAll<HTMLInputElement | HTMLSelectElement>("[data-a11y]")) {
    const key = control.dataset.a11y as keyof AccessibilityPreferences;
    if (control instanceof HTMLInputElement) control.checked = preferences[key] === true;
    else control.value = String(preferences[key]);
    control.addEventListener("change", () => {
      preferences = { ...preferences, [key]: control instanceof HTMLInputElement ? control.checked : key === "voiceURI" ? control.value || undefined : Number(control.value) } as AccessibilityPreferences;
      saveAccessibilityPreferences(preferences);
      applyAccessibilityPreferences(preferences);
    });
  }
  const voiceSelect = el.querySelector<HTMLSelectElement>('select[data-a11y="voiceURI"]')!;
  const paintVoices = () => {
    if (!isSpeechSupported()) return;
    const voices = window.speechSynthesis.getVoices().filter((voice) => voice.lang.startsWith(navigator.language.slice(0, 2))).sort((a, b) => a.name.localeCompare(b.name));
    voiceSelect.innerHTML = `<option value="">System Default</option>${voices.map((voice) => `<option value="${esc(voice.voiceURI)}">${esc(voice.name)}${voice.default ? " (default)" : ""}</option>`).join("")}`;
    voiceSelect.value = preferences.voiceURI ?? "";
  };
  paintVoices();
  if (isSpeechSupported()) window.speechSynthesis.onvoiceschanged = paintVoices;
  for (const rate of el.querySelectorAll<HTMLInputElement>('input[name="speech-rate"]')) {
    rate.checked = Number(rate.value) === preferences.speechRate;
    rate.addEventListener("change", () => {
      if (!rate.checked) return;
      preferences = { ...preferences, speechRate: Number(rate.value) as AccessibilityPreferences["speechRate"] };
      saveAccessibilityPreferences(preferences);
    });
  }
  const resizeComposer = () => {
    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight, 156)}px`;
    input.style.overflowY = input.scrollHeight > 156 ? "auto" : "hidden";
  };
  resizeComposer();
  input.addEventListener("input", resizeComposer);
  input.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
    event.preventDefault();
    form.requestSubmit();
  });

  const add = (cls: string, html: string) => {
    const div = document.createElement("div");
    div.className = `msg ${cls}`;
    div.innerHTML = html;
    log.appendChild(div);
    log.scrollTop = log.scrollHeight;
    return div;
  };

  add(
    "bot",
    advisor
      ? `<span class="ln">Hi! I'm your parking advisor. Tell me about your class, building and time in your own words and I'll suggest where to park and when to arrive.</span><span class="ln fine">I understand you with a hosted AI model run by a third party, so please don't type personal details. Every place, distance, count and permit rule comes from HokiePark's own data; forecasts are simulated.</span>`
      : `<span class="ln">Hi! I answer from the same garage, lot and accessible-parking data shown on the map.</span><span class="ln fine">Demo data &mdash; garage counts are simulated.</span>`,
  );

  let busy = false;
  let pending: HTMLElement | null = null;
  const activity: AdvisorToolEvent[] = [];
  subscribeActivity?.((event) => {
    if (!busy || !pending) return;
    const index = activity.findIndex((item) => item.id === event.id);
    if (index >= 0) activity[index] = event;
    else activity.push(event);
    pending.innerHTML = activityList(activity) || `<span class="ln">Working with HokiePark data&hellip;</span>`;
  });
  /** Every question asked so far, so follow-up chips never repeat one. */
  const asked: string[] = [];

  async function ask(question: string) {
    const q = question.trim();
    if (!q || busy) return;
    busy = true;
    send.disabled = true;
    asked.push(q);
    // The starter chips are a cold-start aid: once the conversation exists, follow-ups live
    // under the latest answer instead, where they scroll away rather than eat the composer.
    suggest.hidden = true;
    add("me", esc(q));
    const requestedLocation = /\b(current location|my location|where i am)\b/i.test(q);
    activity.length = 0;
    pending = add("bot pending", `<span class="ln">${requestedLocation ? "Requesting your location&hellip;" : advisor ? "Starting HokiePark advisor&hellip;" : "Checking the data&hellip;"}</span>`);
    try {
      if (requestedLocation && ensureCurrentLocation) await ensureCurrentLocation();
      const a: Answer = await answer(q);
      pending.className = "msg bot";
      // Only the newest answer carries chips; older ones would pile up into the same clutter.
      for (const old of log.querySelectorAll(".followups")) old.remove();
      // An answer that already lists three "show on map" buttons doesn't need three more chips.
      // Backfill from whichever starter set this mode uses, so advisor mode stays in its own voice.
      const ups = followUpQuestions(a, asked, a.refs.length >= 3 ? 2 : 3, suggestionPool);
      pending.innerHTML = sourceTag(a as AdvisorAnswer, advisor) + agentActivity(a as AdvisorAnswer, advisor) + bubbleLines(a.lines) + refButtons(a.refs) + mapActions((a as AdvisorAnswer).mapActions) + speechControls() + chipRow(ups);
      const routeAction = (a as AdvisorAnswer).mapActions?.find((action): action is Extract<AdvisorMapAction, { type: "show_route" }> => action.type === "show_route");
      if (routeAction) pending.dataset.mapActions = JSON.stringify(routeAction);
      else delete pending.dataset.mapActions;
      if (preferences.autoRead && (a as AdvisorAnswer).source === "ai") speak(a.lines.join(". "), { rate: preferences.speechRate, voiceURI: preferences.voiceURI });
    } catch (err) {
      console.error(err);
      pending.className = "msg bot error";
      pending.innerHTML = `<span class="ln">Sorry, I couldn't answer that. Try again, or use the Map and List tabs.</span>`;
    } finally {
      busy = false;
      pending = null;
      send.disabled = false;
      log.scrollTop = log.scrollHeight;
    }
  }

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const q = input.value;
    input.value = "";
    resizeComposer();
    void ask(q);
  });
  suggest.addEventListener("click", (e) => {
    const chip = (e.target as Element).closest<HTMLElement>(".chip");
    if (chip) void ask(chip.textContent ?? "");
  });
  log.addEventListener("click", (e) => {
    const chip = (e.target as Element).closest<HTMLElement>("button.chip");
    if (chip) return void ask(chip.textContent ?? "");
    const b = (e.target as Element).closest<HTMLElement>("button.ref");
    if (b) onSelect({ kind: b.dataset.kind as "garage" | "lot" | "building", id: b.dataset.id! });
    const response = (e.target as Element).closest<HTMLElement>(".msg.bot");
    if (!response) return;
    const spokenText = [...response.querySelectorAll<HTMLElement>(".ln")].map((line) => line.textContent ?? "").join(". ");
    if ((e.target as Element).closest(".speech-read")) {
      for (const controls of log.querySelectorAll<HTMLElement>(".speech-controls")) {
        controls.querySelector<HTMLElement>(".speech-read")!.hidden = false;
        controls.querySelector<HTMLElement>(".speech-active")!.hidden = true;
      }
      speak(spokenText, { rate: preferences.speechRate, voiceURI: preferences.voiceURI });
      response.querySelector<HTMLElement>(".speech-read")!.hidden = true;
      response.querySelector<HTMLElement>(".speech-active")!.hidden = false;
    }
    const toggle = (e.target as Element).closest<HTMLElement>(".speech-toggle");
    if (toggle) {
      const paused = toggle.dataset.paused === "true";
      if (paused) {
        resumeSpeech();
        toggle.dataset.paused = "false";
        toggle.textContent = "⏸ Pause";
        toggle.setAttribute("aria-label", "Pause spoken response");
      } else {
        pauseSpeech();
        toggle.dataset.paused = "true";
        toggle.textContent = "▶ Resume";
        toggle.setAttribute("aria-label", "Resume spoken response");
      }
    }
    if ((e.target as Element).closest(".speech-stop")) {
      stopSpeech();
      response.querySelector<HTMLElement>(".speech-read")!.hidden = false;
      response.querySelector<HTMLElement>(".speech-active")!.hidden = true;
    }
    if ((e.target as Element).closest(".advisor-route")) {
      const answerIndex = [...log.querySelectorAll<HTMLElement>(".msg.bot")].indexOf(response);
      // map actions are attached to the same response below, never supplied as model JavaScript.
      const action = answerIndex >= 0 ? response.dataset.mapActions : undefined;
      if (action) {
        try {
          const route = JSON.parse(action) as AdvisorMapAction;
          if (route.type === "show_route") onMapAction?.(route);
        } catch { /* no valid action */ }
      }
    }
  });
}
