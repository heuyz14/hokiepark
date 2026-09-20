# HokiePark Product Spec

*Updated 2026-09-20. This is the single product document. Engineering detail lives in [`../architecture/ARCHITECTURE.md`](../architecture/ARCHITECTURE.md); current status in [`../STATE.md`](../STATE.md).*

## 1. Overview

**HokiePark** is a mobile-first parking app for Virginia Tech's Blacksburg campus. It shows drivers a real map of every garage and lot, how many spaces are open (by floor in garages), where accessible (ADA) parking is, which places their permit is valid in, a **forecast** of how full a place will be when they arrive, and an **AI parking advisor** they can ask in plain English.

It was built for **VTHacks 14** (September 18-20, 2026) for the **Deloitte x Databricks "Campus Life Intelligence Hub"** track, and is live at **https://heuyz14.github.io/terraceb/** (installable on an iPhone). It is a working demo, not a production service, and this document is explicit about what is real and what is simulated (Section 5).

## 2. Problem and opportunity

Parking at Virginia Tech is scarce, spread across dozens of differently named lots and garages, and governed by permit rules (faculty/staff, commuter, resident, visitor) that are not obvious from the street. Drivers learn a garage is full only after circling it; drivers who need accessible spaces lose the most time; and no single tool shows the current state of parking, let alone what it will look like at class time.

Circling for a space costs time, fuel, and patience, makes people late, and adds traffic to a walkable campus. Aggregated across a campus, better information can spread demand across garages and lots that go unused while others overflow, and gives planners real usage data. HokiePark is a first, concrete step: prove one high-value use case (find a place to park, including an accessible one, and know whether it will still be open when you arrive) before growing into a broader campus-life hub.

## 3. Users

- **The commuting student** has a commuter permit valid only in certain lots and garage levels, is often close to class time, and needs to know where they are allowed to park and whether it will be full.
- **Faculty and staff** park at the same places daily but still hit full garages, and value knowing which floor has space.
- **Visitors** (tours, parents, event guests) know nothing about VT's parking system and need real building names, clear visitor options, and no jargon.
- **Drivers who need accessible parking** need "is there *accessible* parking, and where exactly", not just "is there parking". This is why ADA information is first-class, not a filter.

## 4. What it does today

**4.1 Map.** A real basemap (OpenFreeMap) with Virginia Tech's own public GIS footprints on top: **102 buildings** colored by VT's campus-map categories (academic, residential/dining, student life, athletic), **85 lots** (every "Main Campus" lot in VT's ParkingLots layer), and the **2 garages** (Perry Street, North End Center) as tappable markers with the number of open spaces. A legend explains every color and symbol. Pan, zoom, fly-to, a "show my location" button, and a reset button. The map needs an internet connection and WebGL; the rest of the app degrades gracefully.

**4.2 Detail sheet and list.** Tapping a garage shows each level (its signage, capacity, open spaces, and accessible spaces). A lot shows its permit class and accessible note. A building shows its nearest parking. The **List** tab shows all garages, lots, and buildings, searchable by name or official code (for example `TORG`), and stays in sync with the map.

**4.3 Accessible (ADA) parking.** One wheelchair badge marks accessible parking everywhere: garage level rows, lot sheets, list rows, map markers, and the legend, in a blue deliberately distinct from residential-building blue. Five lots have designated accessible spaces (40 in total in the demo data), and each garage level shows its own accessible count. An "accessible plate or placard" toggle makes accessible-only spaces available to your permit checks.

**4.4 Permit eligibility.** "Set your permit" (eight VT permit types, multi-select) dims what you cannot use. Verdicts come from VT's 2026-27 Parking Quick Guide and campus parking map and are `yes`, `no` (with the reason), or `check the posted sign`. The app never guesses: a lot whose signage is not confirmed (66 of 85 have no known class) can never return a confident yes, and a plain Commuter permit is never offered Perry Street Garage.

**4.5 Plan ahead.** Choose a destination building, weekday, class start time, and permit. The app ranks up to three places by walk time and **forecast fullness at arrival** (15 minutes before class), labels each *Likely open*, *Filling up*, or *Risky*, and shows what the map says right now for comparison. Only permit-confirmed places are recommended; unconfirmed nearby places are listed separately; ruled-out places are never shown. Forecast numbers come from the Databricks-trained model (Section 7).

**4.6 Ask.** Two engines share one chat. A **rule-based assistant** answers the core questions ("where is the closest open parking to Squires Student Center", "is there accessible parking near Cassell Coliseum", "which garage has the most open spots") from the same data as the map, and understands plan-ahead phrasing ("2pm class in Hancock Hall"). An optional **AI advisor** handles messier requests and follow-ups ("when should I arrive at Hancock for a 10am class?", then "commuter"). The AI never supplies facts: it chooses among seven deterministic tools that run in the app on its own data and phrases their results; any number it writes that no tool returned, or any place no tool returned, causes the answer to be rejected and the built-in answer to be used, badged "Basic answer" with the reason. Answers take about 2-4 seconds and cost roughly a quarter of a cent.

**4.7 Live counts.** Garage counts come from a Supabase table the app polls every 15 seconds (read-only), advanced every minute by a simulator that steers each level toward a target for the current time. A header chip shows `Live . 12s ago` or warns when data is stale or offline. With no configuration the app runs on bundled sample counts.

## 5. Data and accuracy

| Data | Real, assumed, or generated | Source |
| --- | --- | --- |
| Building and lot footprints, positions, names, lot areas | **Real** | VT's public ArcGIS layers (`arcgis-central.gis.vt.edu`), pulled once and committed |
| Class meetings (building, days, times, seat capacity) | **Real** | VT's public Timetable of Classes, Fall 2026: 5,317 meetings; 99.1% of weekly seats placed on a campus building using VT's official building-code list. Capacity is a seat cap, **not enrollment** |
| Permit rules | **Real, but incomplete** | VT Parking Services' 2026-27 Quick Guide and map; 19 of 85 lots have a known class |
| Lot capacities | **Estimated** | Derived from real polygon area (no surface-lot capacity is published) |
| Garage level counts and accessible counts | **Hand-set** | Level signage follows VT's map; counts are not sensor data |
| Driver behaviour (arrival and departure spread, how many students drive, staff schedule) | **Assumed** | Labelled, tunable placeholders |
| Occupancy shown as "live" and used to train the forecast | **Simulated** | Class-timetable-shaped simulator with randomised behaviour; **no real occupancy data exists** |

The consequence is stated wherever it matters: occupancy is simulated, and the forecast model is trained on that simulation, so its accuracy measures how well it recovers the simulation, not real-world accuracy. Building heights are absent from VT's public data, so the map is 2D.

## 6. How it is built

One TypeScript codebase bundled by esbuild into a single self-contained HTML file plus PWA files, using MapLibre for the map. No backend is required: the optional pieces are a Supabase project (live counts, row-level-security read-only, a simulator on `pg_cron`) and a Supabase Edge Function that holds the AI model key and relays one model turn at a time (OpenRouter models, with Gemini supported). Hosting is GitHub Pages, deployed manually from a workflow. Secrets never reach the browser: only the Supabase URL and public keys are baked in, the function validates and rate-limits requests, allow-lists origins, and the build refuses a secret key. Quality is enforced by 228 unit tests, 26 model tests, an end-to-end browser test at three screen sizes plus a mocked-feed and mocked-advisor run, and CI on every push. Full detail: [`../architecture/ARCHITECTURE.md`](../architecture/ARCHITECTURE.md).

## 7. Databricks

**What runs on Databricks today** (Free Edition, Unity Catalog): notebooks 01-04 ingest the timetable into Delta tables (bronze, silver, gold), join it to VT's buildings with quality gates, and build occupancy curves tracked in MLflow. Notebooks 05-07 generate training data with a Monte Carlo simulator (100 simulated days across 94 places, about 900,000 labelled rows) because no real history exists, train and evaluate a gradient-boosted forecaster in MLflow, register it in Unity Catalog, and batch-score every place, weekday, and 15-minute slot into a lookup the app reads with no live Databricks dependency. Evaluation is honest about what it can show: on held-out days the model only matches a lookup (2.45 vs 2.41 points of error, the simulator's noise floor); on **held-out places** (lots never seen in training) it reaches 2.99 points against 7.30 for a place-agnostic average, and dropping the class-schedule features raises that to 4.83. Details: [`../databricks/ML_FORECASTER.md`](../databricks/ML_FORECASTER.md).

**Production vision.** With real sensor data the same pipeline becomes a real forecast: **Delta Live Tables** would ingest and validate sensor and permit feeds into current-occupancy tables; **Unity Catalog** would govern one set of definitions (garage, lot, level, ADA space), access control (only VT Parking Services systems may write occupancy), and lineage from any number in the app back to its source reading; **MLflow** would track models trained on real history (time of day, weekday, academic calendar, football Saturdays, weather); **Genie** would give ad hoc, governed questions over that data (for example, which garages had space every day this week at 9am); and a live **Model Serving** endpoint would replace batch scoring once per-request inference is worth the added risk. Genie and live serving are not built.

## 8. Scope, limitations, and open questions

**Goals of the hackathon build:** an accurate map of the real campus; the full journey from map to detail to a plan and an AI answer; accessible parking as a first-class feature; permit-aware answers that never guess; VT's own visual identity; and a Databricks architecture a technical judge can evaluate as real.

**Non-goals:** real sensor data (none was accessible), turn-by-turn driving directions, permit purchase or citations, a native app (it is an installable web app), and 3D buildings.

**Limitations:** all occupancy is simulated and the forecast is not validated against reality; lot capacities are derived and most lots have no known permit class; accessible counts are illustrative; walk times are straight-line at a fixed pace (no routing or hills); the timetable gives seats, not attendance; the map and the advisor need internet; and the free/low-cost hosted AI models can be slow or unavailable, in which case the built-in assistant answers.

**Open questions for production:** does VT Parking Services have, or plan, real-time garage and lot sensors, and would they share the data? How should accessible-space designations stay current as construction changes lots? Should HokiePark integrate with VT's permit system so users see only lots they are eligible for? What privacy and retention policy applies to any usage data a production version would collect (the advisor already sends typed questions to a third-party model host, which the app discloses)?

## 9. Roadmap

1. **Phase 1, hackathon pilot (done):** the demo above, live on the web.
2. **Phase 2, real data:** live occupancy from VT's sensors and permit systems, GIS kept in sync, Delta Live Tables and Unity Catalog online.
3. **Phase 3, intelligence:** forecasts trained on real history and campus events, Genie for governed questions, personalization (a commuter's usual permit zone), live model serving.
4. **Phase 4, Campus Life Intelligence Hub:** dining wait times, study-space and library seats, shuttle tracking, event and building hours, on the same governed platform and map-first interface.

Each phase ships on its own; Phase 1 already solves an everyday problem.

## 10. Glossary

**ADA parking:** spaces designated for drivers with disabilities under the Americans with Disabilities Act, marked with a wheelchair symbol. **GIS:** a system of data tied to real-world locations, here VT's official building and lot records. **Databricks:** a data platform for storing, processing, and modeling large data. **Delta Live Tables:** a Databricks tool that continuously turns raw incoming data into clean tables. **Unity Catalog:** Databricks' governance layer (definitions, access control, lineage). **MLflow:** tracking and registry for machine-learning models. **Genie:** Databricks' plain-English interface over governed data. **Monte Carlo simulation:** generating many randomised runs to produce training data when real data does not exist. **Persona:** a description of a type of user, used to design around real needs.

## 11. Team and credits

Built by a four-person team for VTHacks 14, for the Deloitte x Databricks "Campus Life Intelligence Hub" track. Draws on Virginia Tech's public GIS services, its public Timetable of Classes, its 2026-27 Parking Quick Guide, and its campus-map color conventions. Independent hackathon prototype, not an official Virginia Tech service. Code released under the MIT License (`../../LICENSE`); the data displayed remains subject to Virginia Tech's terms.
