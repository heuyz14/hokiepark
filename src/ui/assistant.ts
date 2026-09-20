import type { Answer, AnswerRef, Answerer } from "../lib/assistant.ts";
import { followUpQuestions, SUGGESTED_QUESTIONS } from "../lib/assistant.ts";
import { ADVISOR_SUGGESTIONS, ADVISOR_TOOL_LABELS, type AdvisorAnswer } from "../lib/advisor.ts";
import { isSpeechSupported, pauseSpeech, resumeSpeech, speak, stopSpeech } from "../lib/speech.ts";
import type { Selection } from "../types.ts";
import { esc } from "./format.ts";

export interface AssistantOptions {
  answer: Answerer;
  onSelect: (sel: Selection) => void;
  /** True when the Gemini-backed advisor is wired in: changes the greeting, suggestions and answer badges. */
  advisor?: boolean;
  /** Permission is still requested by the normal map/browser flow; no coordinates reach this component. */
  ensureCurrentLocation?: () => Promise<boolean>;
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
    ? `<div class="speech-controls"><button type="button" class="speech-read" aria-label="Read this response aloud">Read aloud</button><button type="button" class="speech-pause" aria-label="Pause spoken response">Pause</button><button type="button" class="speech-resume" aria-label="Resume spoken response">Resume</button><button type="button" class="speech-stop" aria-label="Stop spoken response">Stop</button></div>`
    : "";

export function createAssistant(el: HTMLElement, { answer, onSelect, advisor = false, ensureCurrentLocation }: AssistantOptions): void {
  const suggestions = advisor ? ADVISOR_SUGGESTIONS : SUGGESTED_QUESTIONS;
  el.innerHTML = `
    <div class="chat">
      <div class="chat-log" id="chat-log" role="log" aria-live="polite" aria-relevant="additions"></div>
      <div class="chat-suggest" id="chat-suggest">
        ${suggestions.map((q) => `<button type="button" class="chip">${esc(q)}</button>`).join("")}
      </div>
      <form class="chat-form" id="chat-form" autocomplete="off">
        <label for="chat-q" class="sr-only">Ask a parking question</label>
        <input id="chat-q" type="text" placeholder="${advisor ? "Describe your class and permit&hellip;" : "Ask about parking&hellip;"}" enterkeyhint="send" maxlength="200">
        <button type="submit" class="send">Send</button>
      </form>
    </div>`;
  const log = el.querySelector<HTMLElement>("#chat-log")!;
  const suggest = el.querySelector<HTMLElement>("#chat-suggest")!;
  const form = el.querySelector<HTMLFormElement>("#chat-form")!;
  const input = el.querySelector<HTMLInputElement>("#chat-q")!;
  const send = el.querySelector<HTMLButtonElement>(".send")!;

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
    const pending = add("bot pending", `<span class="ln">${requestedLocation ? "Requesting your location&hellip;" : advisor ? "Thinking it through&hellip;" : "Checking the data&hellip;"}</span>`);
    try {
      if (requestedLocation && ensureCurrentLocation) await ensureCurrentLocation();
      const a: Answer = await answer(q);
      pending.className = "msg bot";
      // Only the newest answer carries chips; older ones would pile up into the same clutter.
      for (const old of log.querySelectorAll(".followups")) old.remove();
      // An answer that already lists three "show on map" buttons doesn't need three more chips.
      // Backfill from whichever starter set this mode uses, so advisor mode stays in its own voice.
      const ups = followUpQuestions(a, asked, a.refs.length >= 3 ? 2 : 3, suggestions);
      pending.innerHTML = sourceTag(a as AdvisorAnswer, advisor) + agentActivity(a as AdvisorAnswer, advisor) + bubbleLines(a.lines) + refButtons(a.refs) + speechControls() + chipRow(ups);
    } catch (err) {
      console.error(err);
      pending.className = "msg bot error";
      pending.innerHTML = `<span class="ln">Sorry, I couldn't answer that. Try again, or use the Map and List tabs.</span>`;
    } finally {
      busy = false;
      send.disabled = false;
      log.scrollTop = log.scrollHeight;
    }
  }

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const q = input.value;
    input.value = "";
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
    if ((e.target as Element).closest(".speech-read")) speak(spokenText);
    if ((e.target as Element).closest(".speech-pause")) pauseSpeech();
    if ((e.target as Element).closest(".speech-resume")) resumeSpeech();
    if ((e.target as Element).closest(".speech-stop")) stopSpeech();
  });
}
