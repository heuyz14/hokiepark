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

## 7. 2026-09-19 - database questions and the Supabase build

> where is the database for this

> wouldnt u need the database if were implementing live occupancy

> yes build the supabase version

**Outcome:** Explained there is no database by design (client-side demo), then agreed live occupancy needs a data store. Built the optional Supabase feed: read-only RLS table `garage_levels`, generated seed, SQL simulator (+ optional pg_cron), zero-dependency polling client with strict validation and all-or-nothing apply, header sync chip, build-time guard against embedding a service-role key, `check:supabase` verifier, and a mocked-Supabase e2e (`smoke:live`). Needs from the user: a Supabase project + its public URL/anon key (see docs/SUPABASE.md).

## 8. 2026-09-19 - commit identity

> also find out why im commiting from a different github profile than heuyz14 and fix that to set push from heuyz14 from our work

**Outcome:** Root cause: global `~/.gitconfig` identity is `hle142025S <heuyz48@gmail.com>` (a different GitHub account whose display name is "heuyz14"), so commits were attributed to it. The push credential in the Keychain was already heuyz14 (account id 204778464). Fixed with a repo-local identity `heuyz14 <204778464+heuyz14@users.noreply.github.com>`; global config untouched; earlier commits not rewritten.

## 9. 2026-09-19 - identity for the entire folder

> change the identity for the entire folder

**Outcome:** Read as "every repo under ~/ProjectPort". `laelaps` and `nqmate` already used `heuyz14 <heuyz14@yahoo.com>` (GitHub credits that email to heuyz14), so standardized on it: added an `includeIf "gitdir:/Users/bubba/ProjectPort/"` rule in `~/.gitconfig` pointing at `~/.gitconfig-projectport`, removed terraceb's repo-local override, and verified all four repos plus a fresh repo inside the folder; outside the folder the global identity is unchanged. Backup: `~/.gitconfig.bak-before-projectport`.

## 10. 2026-09-19 - free-only, iPhone, next steps

> i want it all free  /  how do i test on iphone  /  iphone web checks out whats next  /  are these numbers stagnant  /  whats taking so long

**Outcome:** Constraint recorded: everything must be free (GitHub Pages public repo, Supabase free tier, rule-based assistant; a free-tier LLM such as Gemini/Groq is only an optional later add-on, exact terms to be confirmed first; Anthropic has no free API tier). iPhone test done by the user over Wi-Fi (http://<mac-ip>:8080). Explained counts are static until `simulate_occupancy_tick()` runs. Built the permit-eligibility filter meanwhile.

## 11. 2026-09-19 - class-schedule-driven occupancy + Databricks skills (pasted proposal)

> consider this for my terraceb hokie park and how i can implement
> (pasted text: install databricks ai-dev-kit skills via Databricks CLI; drive garage occupancy from VT Timetable of Classes -> building join -> 15-min demand curve -> simulator -> JSON, plus MLflow model)

**Outcome:** Analysis only, no code changed. Probed the live VT timetable: POST to `https://selfservice.banner.vt.edu/ssb/HZSKVTSC.P_ProcRequest` works (apps.es.vt.edu 307-redirects there). Columns are CRN, Course, Title, Type, Modality, Cr Hrs, **Capacity** (NOT enrollment), Instructor, Days, Begin, End, Location ("GBJ 104"). Gaps vs the proposal: capacity is a seat cap; locations use building abbreviations that `buildings.json` lacks (only num/name); only 2 garages have occupancy in the app (lots are static); garages are mostly F/S permit, so student class density is a weak driver; today is a weekend so "today's timetable" is empty at demo time. Recommendation: Tier A in-repo weekday-replay demand curve feeding the Supabase tick; Tier B Databricks notebook for the track story. Awaiting go-ahead.

## 11. 2026-09-19 - resolve the teammate merge

> no resolve our merge conflicts and keep theirs if it works, if it doesnt work or match then fix and repush

**Outcome:** A teammate's commit (af7a12d) added a VT-sourced permits module overlapping my permit filter in 9 files. Merged origin/main, took THEIR side for every conflict, restored their template, dropped my permit implementation, and rewrote the smoke permit scenarios for their picker. Verified: 82 unit tests, typecheck, and 6 browser runs (3 sizes x feed off/mock-live) all pass. Pushed.

## 12. 2026-09-19 - go-ahead for Tier A

> yes

**Outcome:** Built Tier A of the class-schedule occupancy: timetable parser + one-time fetch (`npm run timetable`), official building-code map (`data/timetable-building-codes.json`), demand model (`src/lib/demand.ts`), generated `supabase/curves.seed.sql` (`npm run curves`), migration `20260919120000_class_schedule_curves.sql` (private curves + `sim_config` demo clock, new `simulate_occupancy_tick()` that steers toward the curve), 101 tests passing, SQL verified on real Postgres (PGlite, scratchpad only). Added spec section + SUPABASE.md docs. Needs from the user: run the migration and `curves.seed.sql` in the Supabase SQL editor.

## 13. 2026-09-19 - check migrations, then "it worked continue, reset and reanalyze what needs to be implemented next"

> check all my mirgations  /  it worked continue, also reset and reanalyze what needs to be implemented next, pull if necessary

**Outcome:** Verified both migrations against the real project as far as the anon key allows (tables exist and are private; the tick moved counts at 19:12 UTC). Re-analysis found: site NOT deployed (Pages 404, no workflow runs, no Actions Variables); a sawtooth flaw in my curves (fixed by smoothing, regression test mutation-checked); wrote `docs/DEMO_RUNBOOK.md`. Coordinated file ownership with the parallel session (projectport-e7, works in its own worktree). Remaining priorities: deploy (user), pg_cron (user), rehearsal, Databricks Tier B scaffold, polish.

## 14. 2026-09-19 - simulator works; label fix + permit-aware assistant, synced with the other agent

> yes do this also sync with my other agent running so there are no problems

**Outcome:** Coordinated with the other session (projectport-f5) over SendMessage before editing: agreed disjoint file lists, explicit-path staging only, fetch+merge before every push. Worked in an isolated git worktree (`terraceb-wt-e7`, branch `e7-labels-assistant`). Shipped (1) signage-is-code: level labels + permit classes always come from the app, the DB supplies only live counts, `check:supabase` warns on label drift, so re-running `seed.sql` is now optional; (2) the Ask assistant honors the permit chooser via lib/permits verdicts. Bugs found by testing my own work and fixed: multi-permit answers mislabeled a garage with 133 usable spaces as "no open spaces"; "Stanger St. ADA" was read as a generic accessible-parking request; two of my checks were vacuous and were tightened (mutation-verified).

## 15. 2026-09-19 - "run npm dev and pull to see changes so far and whats next" / "it works now whats next databricks?"

> run npm dev and pull to see changes so far and whats next  /  1 (pasted a 404 page)  /  it works now whats next databricks?

**Outcome:** Ran `npm run dev` (watch build only; the app is served from `dist/` on port 8080, so the URL is `http://localhost:8080/`, my first `/dist/index.html` link was wrong and 404'd). Header chip showed "Data 53m ago" (no tick since 19:12 UTC; pg_cron still needed). Then built the Databricks Tier B scaffold in `databricks/` (details in STATE.md), verified locally as far as possible, and documented what is unverified.

## 16. 2026-09-19 - running the Databricks notebooks

> i ran seed.sql and curves.seed.sql, whats next i also set up my free databricks account  /  notebooks are in my workspace what next  /  the last cell is skipped for 1  /  what do i upload  /  done  /  notebook 04 finished, what next  /  downloaded the curves file, compare it

**Outcome:** Made `databricks/upload/` (the 4 input files, git-ignored) for the volume upload. The "last cell skipped" in notebook 01 was the intended missing-file stop. After upload, notebooks 01-04 all completed on the user's Free Edition workspace, and the exported `curves.seed.sql` matched the repo's file exactly after the header line (diffed here). Databricks Tier B is now verified end to end except `bundle deploy` and Genie.

## 17. 2026-09-19 - the Databricks ML spec and "deep databricks implementation"

> deploy the site to github pages, also whats next for the databricks part? [Databricks ML spec attached]  /  how long would ML take fastest  /  lets do it i want a deep databricks implemenatation in hokiepark but explain what its for and how were are training it with what data and where is the data coming from

**Outcome:** Pages deploy not done by me (needs the user's GitHub settings; CI simulated cleanly on a fresh clone under Node 24, see STATE). Read the ML spec and corrected it against tested facts (timetable has capacity not enrollment; lots have invented/derived capacities; simulated-label circularity). Built the forecaster: Monte Carlo simulator, evaluation on held-out days AND places with ablation, MLflow + Unity Catalog registration, batch scoring to `predictions.json`, bundle tasks, 26 Python tests, and `docs/DATABRICKS_ML.md`. Decided the app-side "plan ahead" recommender should consume the workspace-produced `predictions.json`, so it comes after the user runs notebooks 05-07.

## 18. 2026-09-19 - Gemini/NLP question, then "write the spec and then finish the recommender"

> notebooks 05-07 finished, i want to maybe use gemini API to use NLP ... vector database ... embeddings ... would this be easy to implement so i can decide to spec it  /  write the spec and then finish the recommender, the notebooks finished a while ago  /  check again

**Outcome:** Advised against a vector DB (about 200 items fit in a prompt) and for LLM-as-structured-extractor behind a proxy with rule-based fallback; wrote `docs/GEMINI_NLP_SPEC.md` (not built). Found the real `predictions.json` in Downloads, validated it (schema, ids/capacities, 0.15 pt mean diff vs the local run), installed it as `src/data/predictions.json`. Built the Plan tab + Ask plan-ahead answers with permit-safety rules, 21 tests (mutation-checked) and smoke scenarios. Discovered a pre-existing 375x667 smoke failure from the map rewrite (not caused by this work).

## 19. 2026-09-19 - "what would the ask tab even be for now" / build Gemini as a parking agent / disk full / "disk freed up, continue and push fix and changes"

> so what would the ask tab even be for now  /  i want to build gemini so the ask tab has a purpose and would the purpose be strong enough to keep it or can we make this into a parking agent for advice  /  disk freed up, continue and push fix and changes

**Outcome:** Answered that Plan is structured/future and Ask should be the conversational advisor; built the Gemini parking advisor as a grounded tool-using agent (details in STATE.md and `docs/GEMINI_NLP_SPEC.md`), tested without a key. The disk filled mid-work (smoke runs leaked Chrome profiles); after the user freed space I merged the other session's fix (`b74fed0`), re-applied my smoke changes on top (clean), verified everything, wrote `check:advisor`, and pushed. Waiting on the user for the Gemini key and the Supabase function deploy.
