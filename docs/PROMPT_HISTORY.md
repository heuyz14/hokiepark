# Prompt history

Append-only log of what the user asked for, so a fresh session can recover intent. Newest last.
Prompts are quoted verbatim; the "Outcome" line is a one-sentence summary of what was done.
See [STATE.md](STATE.md) for where the build currently stands.

---

## 1. 2026-09-19 - kickoff

> '/Users/bubba/ProjectPort/terraceb' look in the spec, expand and divide it up for implementation and architecture'/Users/bubba/ProjectPort/terraceb/HokiePark - 6-Hour Build Plan.md' and start implementation, ask if u need help from my end setting up the database and stuff

**Outcome:** Read `HOKIEPARK_SPEC.md` and the 6-hour build plan. Concluded no database is needed (single-file, client-side demo). Started Phase 0-3 implementation with a modular TypeScript source tree that bundles to one HTML file.

## 2. 2026-09-19 - context preservation (sent mid-build)

> set up a current state file and prompt history to preserve context

**Outcome:** Created `docs/STATE.md` (living status) and this file. Both must be updated at the end of every task.

## 3. 2026-09-19 - iOS / mobile target

> i think we are planning to run this on ios/mobile deveice while also supporting web

**Outcome:** Explained that the app is already phone-first but needs HTTPS hosting, and that the Artifact-platform AI sampling will not exist outside claude.ai. Asked native vs PWA and AI-backend questions (the question dialog was declined for clarification).

## 4. 2026-09-19 - Xcode question

> would xcode take long to implement and would it be separate from the web

**Outcome:** Checked: Xcode is NOT installed (only Command Line Tools). Explained Capacitor (same codebase, ios/ shell; needs Xcode ~10 GB, Apple ID; $99/yr for TestFlight/App Store) vs SwiftUI rewrite (separate codebase, days). Recommended PWA first, Capacitor later.

## 5. 2026-09-19 - go-ahead

> yes that sounds good continue, only stop when you need me to perform an action and make sure you document all work and estimated remaining time periodically

**Outcome:** Decisions taken: (a) PWA is the mobile target (iOS via Safari "Add to Home Screen"), Capacitor deferred; (b) AI assistant is deterministic/rule-based on the app's own data (no API key, no backend, no cost) behind an `Answerer` interface so an LLM proxy can be added later. Standing instruction: work autonomously, stop only for user-only actions, keep STATE.md updated with work log + remaining-time estimate.

## 6. 2026-09-19 - periodic commits (sent mid-build)

> make sure to periodically upload work to the current repo with commit and push check if upstream needs to be set, resolve any merge conflicts and prioritize current code from my user

**Outcome:** Upstream was already set (`origin/main` -> github.com/heuyz14/terraceb). A teammate had pushed an independent Leaflet prototype at the repo root (no file overlap). Made 2 commits, merged `origin/main` with a normal merge (no conflicts), pushed. First push failed with HTTP 400 (payload > default 1 MB post buffer); fixed with `git -c http.postBuffer=524288000 push`. Standing routine: commit + push after each meaningful chunk; on conflict, keep the user's local code.
