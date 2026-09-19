# HokiePark — 6-Hour Build Plan

2026-09-19 · @Someone

## Approach & assumptions

Build HokiePark as the single self-contained HTML artifact the spec already describes (Section 11) — one file, SVG map, three JS data arrays (`BUILDINGS`, `LOTS`, `GARAGES`), AI sampling capability for the assistant. This plan assumes a 4-person team working in parallel lanes rather than sequentially, since 6 hours is too tight for one person to do all of this serially.

Role split:

- **Data/Map engineer** — owns Phase 0 and Phase 1: GIS data pull, projection math, SVG building rendering, pan/zoom.
- **Feature engineer** — owns Phase 2: garages, lots, detail sheet, list view, fly-to.
- **AI/Polish engineer** — owns Phase 3 and Phase 4: ADA badges, VT branding, the chat assistant.
- **PM/QA/Design** — curates VT color values and copy up front, floats across lanes, then owns Phase 5 (QA) and Phase 6 (rehearsal) once feature work lands.

Key assumptions this plan makes, called out so they can be corrected early: (1) the VT ArcGIS endpoint (`arcgis-central.gis.vt.edu`) is reachable from the build environment — if not, the team falls back immediately to a hand-curated JSON of the \~15–20 most recognizable buildings rather than losing time debugging network access; (2) "full working demo" means the experience in Sections 5–8 of the spec (map, detail sheets, ADA indicators, AI assistant) working end-to-end, not all 92 buildings GIS-verified — building coverage is treated as gradually improvable and is first on the cut list; (3) the demo runs from a laptop browser during judging, so no deployment/hosting step is in this plan beyond having the file open and ready.

The six phases below total 6:00 exactly, with Phase 6 reserved entirely for rehearsal — not buffer for unfinished features. If a phase runs long, cut from Section 8's cut list rather than eating into rehearsal time.

## Phase 0 — Setup & data pull (0:00–0:30)

Goal: a scaffold file and real campus data saved locally, so nothing later in the day depends on a live network call.

1. Create `index.html` with empty `BUILDINGS`, `LOTS`, `GARAGES` arrays and a blank SVG canvas — this is the file every lane commits into for the rest of the day.
2. Query VT's ArcGIS REST service for the `Buildings` layer (name, category, building number, lat/lon) and the `ParkingLots` layer (name, status, classification).
3. Immediately save both raw responses to local JSON files. From this point on, all work reads from the local files, never the live endpoint — this removes network flakiness as a risk for the rest of the build.
4. Write a short parsing script that flattens the raw GIS records into the flat shape the app needs: `{name, category, lat, lon, footprint}` per building, `{name, status, classification}` per lot.
5. Spot-check 8–10 landmark buildings (Burruss Hall, Squires, Torgersen, Newman Library, Lane Stadium) by eye against a known VT map to catch a bad field mapping before it propagates into 90+ records.

**Exit criteria:** local JSON with 90+ buildings and 19 lots, each with usable lat/lon; scaffold file committed; every teammate can pull the same data files rather than re-querying GIS themselves.

## Phase 1 — Core map (0:30–2:00)

Goal: campus is recognizable at a glance and the map is smooth to use, before any parking-specific features are added on top.

1. Write the equirectangular projection function (lat/lon → flat x/y) and calibrate it against two known landmarks (e.g. Burruss Hall and Lane Stadium) before trusting it for all 92 buildings — catching a sign or scale error here saves redoing every building's position later.
2. Render each building as an SVG shape sized and positioned from its footprint, colored by the four-category VT palette: maroon (academic), blue (residential/dining), tan (student-life/support), peach (athletic).
3. Render the Drillfield as open green space, not a colored building shape, matching how it reads on VT's own map.
4. Implement pan (drag) and zoom (scroll/pinch, or +/− buttons for trackpad-only testing) on the SVG's `viewBox`, plus a reset-to-full-campus button.
5. Add the persistent legend (four building colors + a placeholder wheelchair entry to be wired up in Phase 3).

**Exit criteria:** a teammate unfamiliar with the code can look at the rendered map and immediately recognize it as Virginia Tech's campus; pan/zoom doesn't lag or break with the full building set loaded.

## Phase 2 — Garages, lots, detail sheet, list view (2:00–3:30)

Goal: tapping anything parking-related — on the map or in a list — gets you a real, useful answer.

1. Add the `GARAGES` array (Perry Street Garage, North End Center Garage), each with a `levels` list: label, capacity, occupied, ADA capacity, ADA occupied. Seed with realistic hand-set numbers per the spec's Phase-1 scope (Section 9) — live sensor data is explicitly out of scope for this build.
2. Extend `LOTS` with a permit-type field and an `hasADA` boolean, flagging the five real VT lots the spec names (Squires-area, Cassell Coliseum, University Bookstore, North Drillfield-area).
3. Render garages and lots as distinct, tappable map markers, visually separate from building shapes.
4. Build the bottom detail sheet: for a garage, a level-by-level breakdown (label, occupancy, ADA badge per level); for a lot, name, permit type, status, and an ADA note when flagged.
5. Build the searchable list view (all garages + lots by name) with a fly-to animation that recenters/zooms the map when an item is selected from the list, and vice versa — map and list must stay one consistent experience, not two disconnected screens.

**Exit criteria:** every garage level and every lot's ADA status is visible within one tap from either the map or the list; fly-to works both directions without visual glitches.

## Phase 3 — ADA indicators & VT branding (3:30–4:30)

Goal: accessible parking is visible everywhere it's relevant, at the same visual prominence as regular occupancy — not a hidden filter — and the app reads as VT's own, not a generic map skin.

1. Build one reusable wheelchair badge component (icon + open-space count) and use it in three places: garage level rows, flagged lot detail sheets, and the map legend. One component, three call sites — don't build this three separate times.
2. Wire the badge into every garage level (from Phase 2's per-level ADA counts) and every lot flagged `hasADA`.
3. Apply Virginia Tech's maroon and orange to buttons, active/selected states, and header chrome; keep a separate, distinct blue for the ADA badge so it's never confused with the residential-building blue already used on the map.
4. Wrap the app in the phone-frame layout: map as the primary view, bottom sheet overlay for details, matching the mainstream map/transit-app pattern so no one needs onboarding.
5. Pass over typography and contrast for outdoor daylight readability — test by viewing the screen at max brightness in a bright room.

**Exit criteria:** a reviewer can find accessible-parking status for any garage level or flagged lot without an extra tap or menu; the app is visually identifiable as a VT tool within one glance, before reading any text.

## Phase 4 — AI parking assistant (4:30–5:15)

Goal: a chat assistant that answers parking questions in plain English, using exactly the same data the map and detail sheets already show — never a separate source of truth.

1. Wire up the artifact platform's built-in AI sampling capability (declare it on the artifact so the page can call it directly, without hosting a model). This is scoped last and given the shortest phase deliberately: the map alone is a demoable product if this phase runs short.
2. Build the context payload: serialize the current `BUILDINGS`/`LOTS`/`GARAGES` state (or a compact summary of it) into the prompt so every answer is grounded in what's on-screen.
3. Build a minimal chat UI — input box, message list, loading state — styled to match the phone-frame from Phase 3, not a bolted-on widget.
4. Test against the three example questions from the spec: "where's the closest open parking to Squires Student Center," "is there accessible parking near Cassell Coliseum," and "which garage has the most open spots right now." Treat these three as the acceptance test, not a nice-to-have.

**Exit criteria:** all three sample questions return correct, data-consistent answers; if time is short, ship exactly these three working rather than a broader but flakier assistant.

## Phase 5 — QA & data-consistency pass (5:15–5:45)

Goal: catch the kind of bug a judge finds in the first 30 seconds — numbers that disagree between two parts of the same app.

1. Cross-check every occupancy number: the same garage or lot must show the identical count on the map marker, the detail sheet, the list view, and in an AI assistant answer about it. Since all four read from the same three JS arrays (Section 11), a mismatch means a rendering bug, not a data bug — fix at the display layer.
2. Bug-bash the core interactions deliberately: rapid pan/zoom, tapping quickly between different garages/lots, searching with a partial or misspelled name, a garage at zero open spaces, a lot with no ADA spaces.
3. Test at both a normal desktop width and a phone-sized viewport (browser dev-tools device mode), since the UI is built phone-frame-first and judges may view it on a laptop.
4. Watch the browser console during a full click-through of every feature; treat any thrown error as blocking, not cosmetic.

**Exit criteria:** a full click-through of every feature produces zero console errors; every occupancy/ADA number matches across map, list, detail sheet, and assistant; the app is usable at phone width.

## Phase 6 — Demo rehearsal & fallback (5:45–6:00)

Goal: the live demo works twice in a row, and there's a working fallback if it doesn't work a third time in front of judges.

1. Run the exact demo script twice, timed, on the actual machine and browser that will be used for judging — not a different laptop.
2. Capture 3–4 screenshots of key screens (full map, garage level breakdown, ADA badge close-up, AI assistant answering a question) as an offline fallback in case wifi or the AI call fails mid-demo.
3. Time a 60–90 second narration hitting: the map is built from VT's real GIS data, the garage level drill-down, ADA visibility as a first-class feature, the AI assistant, and one sentence on the Databricks production vision (Section 12).

**Exit criteria:** two clean, timed run-throughs with no blocking bugs; fallback screenshots saved and accessible without wifi; narration reliably under 90 seconds.

## Risk register & cut list

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| VT GIS endpoint slow or unreachable | Medium | High | Pull data once in Phase 0, save it locally, never call the live endpoint again during the build |
| Projection math misplaces buildings | Medium | High | Calibrate against 2 known landmarks before rendering all 92; spot-check early, not after everything is drawn |
| AI sampling capability unfamiliar or rate-limited | Medium | Medium | Build it last (Phase 4), after the map is already demoable on its own; degrade gracefully to "coming next phase" if it breaks |
| Full 92-building set incomplete by Phase 1 end | Medium | Low | Ship whichever subset is verified; add stragglers opportunistically, never block later phases on 100% coverage |
| Running out of time before ADA polish | Low | High | ADA visibility is the stated differentiator (Section 7 of the spec) — protect it specifically; cut visual flourish before cutting ADA badges |

**Cut order if behind schedule** (drop from the bottom up, one at a time, checking the clock after each cut):

1. Fly-to animation — snap the view instead of animating it.
2. List-view search fuzziness — exact-substring match is enough.
3. Full building set — a verified subset of landmark buildings reads as "real VT campus" just as well as all 92.
4. AI assistant scope — keep only the three example questions working; drop open-ended robustness.

**Never cut:** ADA indicators, garage level drill-down, VT color branding. These three are what make HokiePark read as a finished, differentiated product rather than a generic map.

## Minute-by-minute checklist

| Time | Phase | Exit checkpoint |
| --- | --- | --- |
| 0:00–0:30 | Phase 0: Setup & data pull | Local JSON has 90+ buildings and 19 lots with usable lat/lon |
| 0:30–2:00 | Phase 1: Core map | Campus is recognizable at a glance; pan/zoom is smooth |
| 2:00–3:30 | Phase 2: Garages, lots, detail sheet, list view | Every garage/lot is one tap from a correct detail sheet |
| 3:30–4:30 | Phase 3: ADA & branding | ADA badge visible everywhere relevant; app reads as VT-branded |
| 4:30–5:15 | Phase 4: AI assistant | All 3 sample questions answered correctly |
| 5:15–5:45 | Phase 5: QA & consistency | Zero console errors; numbers match everywhere; works at phone width |
| 5:45–6:00 | Phase 6: Rehearsal & fallback | Two clean run-throughs; fallback screenshots ready; narration under 90s |

**Checkpoint discipline:** at each time boundary, check the exit criteria for that phase before starting the next. If a phase is still short of its exit criteria at the boundary, apply one item from the cut list (Section 8) rather than letting the delay cascade into Phase 6.
