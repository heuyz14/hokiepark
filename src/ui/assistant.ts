import type { Answer, AnswerRef, Answerer } from "../lib/assistant.ts";
import { SUGGESTED_QUESTIONS } from "../lib/assistant.ts";
import type { Selection } from "../types.ts";
import { esc } from "./format.ts";

export interface AssistantOptions {
  answer: Answerer;
  onSelect: (sel: Selection) => void;
}

const bubbleLines = (lines: string[]) =>
  lines.map((l) => (l.startsWith("- ") ? `<span class="li">${esc(l.slice(2))}</span>` : `<span class="ln">${esc(l)}</span>`)).join("");

const refButtons = (refs: AnswerRef[]) =>
  refs.length
    ? `<div class="refs">${refs.map((r) => `<button type="button" class="ref" data-kind="${r.kind}" data-id="${esc(r.id)}">Show ${esc(r.label)} on map</button>`).join("")}</div>`
    : "";

export function createAssistant(el: HTMLElement, { answer, onSelect }: AssistantOptions): void {
  el.innerHTML = `
    <div class="chat">
      <div class="chat-log" id="chat-log" role="log" aria-live="polite" aria-relevant="additions"></div>
      <div class="chat-suggest" id="chat-suggest">
        ${SUGGESTED_QUESTIONS.map((q) => `<button type="button" class="chip">${esc(q)}</button>`).join("")}
      </div>
      <form class="chat-form" id="chat-form" autocomplete="off">
        <label for="chat-q" class="sr-only">Ask a parking question</label>
        <input id="chat-q" type="text" placeholder="Ask about parking&hellip;" enterkeyhint="send" maxlength="200">
        <button type="submit" class="send">Send</button>
      </form>
    </div>`;
  const log = el.querySelector<HTMLElement>("#chat-log")!;
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

  add("bot", `<span class="ln">Hi! I answer from the same garage, lot and accessible-parking data shown on the map.</span><span class="ln fine">Demo data &mdash; garage counts are simulated.</span>`);

  let busy = false;
  async function ask(question: string) {
    const q = question.trim();
    if (!q || busy) return;
    busy = true;
    send.disabled = true;
    add("me", esc(q));
    const pending = add("bot pending", `<span class="ln">Checking the data&hellip;</span>`);
    try {
      const a: Answer = await answer(q);
      pending.className = "msg bot";
      pending.innerHTML = bubbleLines(a.lines) + refButtons(a.refs);
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
  el.querySelector("#chat-suggest")!.addEventListener("click", (e) => {
    const chip = (e.target as Element).closest<HTMLElement>(".chip");
    if (chip) void ask(chip.textContent ?? "");
  });
  log.addEventListener("click", (e) => {
    const b = (e.target as Element).closest<HTMLElement>("button.ref");
    if (b) onSelect({ kind: b.dataset.kind as "garage" | "lot" | "building", id: b.dataset.id! });
  });
}
