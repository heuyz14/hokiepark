# HokiePark Product Spec

*Last updated: 2026-09-19*

## 1. Overview

**HokiePark** is a mobile-first parking app for Virginia Tech's Blacksburg campus. It shows students, faculty, staff, and visitors a live, accurate map of every parking garage and lot on campus, tells them in real time how many spaces are open (down to the floor level in parking garages), and highlights accessible (ADA) parking so drivers who need it don't have to guess or circle a garage looking for a sign.

The problem it solves is simple to state and painful to live through: campus parking is scarce, spread across dozens of differently-named lots and garages with different rules (faculty, staff, commuter, visitor, resident), and there is currently no single, trustworthy, visual way to see where an open spot actually is before driving there. HokiePark turns that into a map you can glance at, tap a garage or lot, see the details, and go.

This spec documents HokiePark as built for **VTHacks 14** (September 18–20, 2026), for the **Deloitte × Databricks "Campus Life Intelligence Hub"** track. The track challenges teams to design data-driven tools that make everyday campus life easier to navigate, using a modern data platform (Databricks) as the backbone. Parking was chosen because it is one of the most universally felt pain points on campus — everyone who drives to Virginia Tech has a parking story, and it's a problem real data (garage sensor counts, lot occupancy, official GIS maps) can meaningfully fix.

What exists today is a working, interactive demo: a single-file web app showing a schematic, to-scale map of the real Virginia Tech campus, built from Virginia Tech's own public GIS data, with live-feeling garage occupancy, static lot information, ADA accessibility indicators, and an AI chat assistant that can answer parking questions in plain English. The rest of this document explains, section by section and in plain language, what the app does, who it's for, how it was built, how it would be built for real production use on Databricks, and what's left to do.

## 2. Problem & Opportunity

**Why parking at Virginia Tech is painful today.** Blacksburg's campus packs tens of thousands of students, faculty, and staff, plus regular visitors, into a hilly, historic core with limited room to expand parking. The result is a set of familiar frustrations: drivers don't know which garage or lot is full until they've already driven there and circled it; garages and lots have overlapping, confusing names and permit rules (faculty/staff, commuter, resident, visitor) that aren't obvious from the street; accessible (ADA) spaces are not easy to locate from outside the garage, so drivers who need them lose time driving up level after level; and there is no single map that shows the *current* state of parking — only static signage and, at best, a handful of disconnected systems.

This isn't just an inconvenience — it has real costs. Circling for parking burns time, fuel, and patience; it makes students late to class and visitors late to appointments; it adds avoidable car traffic and emissions to a campus that is otherwise very walkable; and for people who rely on accessible parking, it can be the difference between attending an event on time or not at all.

**Why this is a good hackathon problem.** Parking is a textbook "campus life intelligence" problem: it is fundamentally about turning scattered, real-world data (how many cars are in a garage, where a lot is, which spaces are accessible) into a simple, trustworthy answer a person can act on in the moment ("where should I park right now?"). It plays directly to the Deloitte × Databricks track's theme — using a modern data platform to make everyday campus decisions easier — and Virginia Tech already publishes a lot of the raw data needed (building and lot locations, some parking system feeds) through its public GIS services, which makes a credible, realistic prototype achievable in a hackathon's timeframe.

**The opportunity.** A well-designed parking app doesn't just save individual drivers time — aggregated over a whole campus, it can shift where people park, smooth out demand across garages and lots that currently go unused while others overflow, and give campus planners real usage data to make better long-term decisions about where to add capacity. HokiePark is a first, concrete step toward that: prove the experience works for one campus, with one clear, high-value use case (find a parking spot, including an accessible one, fast), before growing into a broader "Campus Life Intelligence Hub."

## 3. Goals & Non-Goals

**What this spec covers.** This document describes HokiePark as a product: the problem it solves, who it's for, what it does today as a hackathon demo, how it's built right now, and how it would need to evolve to become a real, campus-deployed tool. It is written so that a reader with no prior context — a judge, a teammate joining late, a Deloitte or Databricks reviewer — can understand the whole picture without needing to see the code or the pitch deck first.

**Goals for the hackathon build:**

- Show, convincingly, an accurate map of Virginia Tech's real campus — real building names, shapes, and positions, real garage and lot locations — not a generic or invented layout.
- Demonstrate the core user journey end-to-end: open the app, see live-feeling garage occupancy and static lot info, tap a garage or lot for details, and get an answer to a parking question from an AI assistant.
- Make accessible (ADA) parking a first-class, visible part of the experience, not an afterthought.
- Ground the design in Virginia Tech's own visual identity (its real campus map color-coding, maroon/orange branding) so it feels like it belongs to VT, not a generic map app.
- Make the production vision — how this would actually run on Databricks at full scale — clear enough that a technical judge can evaluate it as a real architecture, not just a slide.

**Explicit non-goals for this build:**

- **Live, sensor-driven occupancy data.** The demo's "live" garage counts are realistic, hand-authored simulated numbers, not a real-time feed from physical VT parking sensors (VT's real systems were not accessible for integration during the hackathon).
- **Turn-by-turn driving navigation.** HokiePark shows *where* to park; it does not provide street-level driving directions to get there.
- **Payment, permits, or citations.** No permit purchase, payment processing, or citation/enforcement functionality is in scope.
- **A native mobile app.** The demo is a responsive web app (phone-frame styled), not a compiled iOS/Android app — though the design is built to translate directly into one.
- **Full building-height/3D modeling.** VT's public GIS building data does not include height or story-count fields, so the map is intentionally 2D and schematic rather than a 3D or satellite-accurate rendering (see Section 9 for the data-sourcing detail).

## 4. Users & Personas

HokiePark is designed around the everyday reality of everyone who drives to or around Virginia Tech's campus. Four personas capture the main ways people use it:

**The commuting student.** Drives to campus for class, doesn't live on or near campus, and has a commuter permit valid in specific lots and garage levels. Needs to know, before leaving home, whether their usual lot is full and where else they're allowed to park — fast, because they're often running close to a class start time.

**Faculty & staff.** Park regularly, often at the same garage or lot, but still hit full garages during peak hours or when visiting a different part of campus for a meeting. Value knowing which floor of a garage has space, so they're not circling levels 1 through 7 of a parking garage.

**Visitors.** Prospective students on a campus tour, parents, event attendees, job candidates, conference guests — people with no prior knowledge of VT's parking system at all. They need the app to be self-explanatory: real building names so they can orient themselves ("park near Squires Student Center"), clear visitor-eligible lots, and no jargon.

**Drivers who need accessible parking.** Students, faculty, staff, or visitors with a disability who need a designated ADA space. For this group, "is there parking" isn't the real question — "is there *accessible* parking, and exactly where in this garage or lot" is. Getting this wrong costs them the most time and dignity, which is why ADA visibility is a core feature (Section 7), not a filter buried in a menu.

Across all four personas, the shared need is the same: a fast, visual, trustworthy answer to "where can I park right now," without needing to already know Virginia Tech's parking system, garage naming conventions, or permit rules.

## 5. Core Feature: The Live Map

The map is the heart of HokiePark. It's a 2D, top-down, schematic view of Virginia Tech's Blacksburg campus, built to real scale from Virginia Tech's own public GIS (geographic information system) data — meaning building positions, shapes, and names are drawn from VT's actual campus records, not sketched by hand or estimated from memory.

**What's on the map:**

- **92 real campus buildings**, each shown as a shape positioned and sized to match its real footprint, colored by category using Virginia Tech's own real campus-map color legend: maroon for academic buildings, blue for residential & dining, tan for student-life/support buildings (admin, library, bookstore, chapel, student centers), and peach for athletic facilities.
- **Parking garages** (Perry Street Garage and North End Center Garage) shown as distinct, tappable landmarks with live-feeling per-floor occupancy.
- **85 parking lots** - every "Main Campus" lot in VT's own ParkingLots GIS layer, not a curated sample - each shown in its real position, tappable for details.
- **The Drillfield**, VT's iconic central green space, shown as an open field rather than colored like a building, matching how it actually reads on VT's official map.
- No road lines. An earlier version of the map included road geometry, but roads cluttered the view and weren't necessary for the core task (finding parking), so they were deliberately removed in favor of a cleaner, more "marketable" look that keeps the focus on buildings and parking.

**Interactions:** the map supports pan and zoom (pinch or scroll), a "fly-to" animation that smoothly recenters and zooms to a garage or lot when you select it from search or the list view, and a reset button that returns to the default full-campus view. Tapping any building, garage, or lot opens a detail sheet (Section 6) with more information.

**Why this matters for the product:** a map that doesn't look and feel like the *real* Virginia Tech campus undermines trust immediately — a VT student or visitor would notice instantly if a familiar building were in the wrong place or missing. Grounding the map in real GIS data, real names, and VT's own color language is what makes HokiePark feel like a legitimate campus tool rather than a generic map mockup.

## 6. Core Feature: Detail Sheet & List View

When a user taps a garage, lot, or building on the map — or selects one from a searchable list — a detail sheet slides up with everything they need to decide where to park.

**For parking garages** (Perry Street Garage, North End Center Garage), the sheet breaks occupancy down level by level. Each level shows its label (for example, "Faculty, staff & visitor" or "Commuter & graduate"), its total capacity, and how many spaces are currently open — including a dedicated count of accessible (ADA) spaces on that level, shown with a wheelchair badge (see Section 7). This level-by-level view is what saves a driver from parking-garage roulette: instead of guessing which floor to try, they can see that Level 2 has space and Level 1 doesn't, before they even pull in.

**For static lots**, the sheet shows the lot's name, its permit type or eligibility (for example, resident, commuter, or visitor), its general status, and — for the five lots on campus with designated accessible spaces — a clear note flagging that ADA parking is available there.

**The list view** is a searchable, scrollable alternative to browsing the map directly: every garage and lot is listed by name, so a user who already knows where they want to park ("is Squires lot full?") can jump straight there without visually hunting across campus. Selecting an item from the list triggers the map's fly-to animation, connecting the list and map views into one consistent experience rather than two disconnected screens.

Together, the map and the detail sheet answer the two questions every driver actually has: *where is parking near me*, and *is there space where I'm headed* — with the accessible-parking answer built in rather than requiring a separate lookup.

## 7. Core Feature: ADA Accessible Parking Indicators

Accessible parking is treated as a core, visible feature of HokiePark, not a hidden filter or footnote — because for a driver who needs an ADA space, knowing a garage is "open" is not useful if they can't tell whether it has an accessible spot, or where.

**How it works today:**

- A universal wheelchair symbol (♿) marks accessible parking everywhere it applies across the app: on the map legend, in garage level breakdowns, and on static lot listings.
- **In parking garages**, each level shows its own accessible-space count as a small badge (wheelchair icon + number) next to that level's regular occupancy count, so a driver can see at a glance not just that a level has open space, but that it has open *accessible* space — without needing to drive up and check in person.
- **In static lots**, five real VT lots are flagged as having designated ADA parking (including the lots near Squires Student Center, Cassell Coliseum, the University Bookstore, and North Drillfield-area lots); each of these shows a clear accessibility note in its detail sheet.
- A dedicated legend entry explains the wheelchair symbol's meaning, so first-time users understand it without guessing.

**Why this was prioritized.** This feature was specifically and repeatedly requested during development, reflecting a broader product principle: accessibility information shouldn't be an extra tap or a separate mode — it should live right alongside the regular parking information, at the same level of visual prominence, everywhere it's relevant. For the persona in Section 4 who needs accessible parking, this single feature can be the difference between a five-minute errand and a twenty-minute ordeal.

**Current limitation and next step.** Today's ADA counts are realistic, manually-set numbers (consistent with the rest of the "live" garage data — see Section 9), not pulled from a real-time accessible-space sensor feed. In production, this would connect to Virginia Tech's actual accessible-space designations and, ideally, real occupancy sensors specific to those spaces (see Section 12).

## 8. Core Feature: The AI Parking Assistant

HokiePark includes a built-in chat assistant that lets users ask parking questions in plain English instead of hunting through the map or list manually — for example, "where's the closest open parking to Squires Student Center," "is there accessible parking near Cassell Coliseum," or "which garage has the most open spots right now."

The assistant is aware of the app's current data — the same garage level counts, lot statuses, and ADA flags shown elsewhere in the app — so its answers stay consistent with what the map and detail sheets already show; it's a different way to reach the same trustworthy information, not a separate source of truth. This matters especially for the visitor persona (Section 4), who may not know VT's building or lot names well enough to search confidently, but can always just describe what they're looking for in their own words.

In the current hackathon build, the assistant is implemented using the Artifact platform's built-in AI sampling capability, which lets the app ask an AI model a question and get a response directly, without HokiePark needing to run or host its own language model. In a production deployment, this same conceptual feature would be powered by Databricks' **Genie** (see Section 12), which would let the assistant answer questions grounded directly in live, governed campus parking data rather than a fixed snapshot — the natural next step once the app is connected to a real data platform.

## 9. Data & Map Accuracy

One of the most important decisions in this project was to build the map from **real Virginia Tech data** rather than an artist's impression of campus — and to be transparent about exactly how accurate each part of it is.

**The source:** Virginia Tech publishes its own campus geographic data publicly through an ArcGIS REST GIS service (`arcgis-central.gis.vt.edu`), including a `Buildings` layer (names, building numbers, categories, and precise latitude/longitude positions for buildings across campus) and a `ParkingLots` layer (lot names, status, and classification). HokiePark's map was built by querying these official services directly — the same underlying data Virginia Tech itself uses for its own campus map — rather than guessing coordinates by eye.

**How real coordinates became a flat map:** GIS data gives latitude/longitude positions, which describe points on a curved globe. To turn those into an accurate flat, top-down map, the team used a standard cartographic technique (an equirectangular, or "Plate Carrée," projection): it mathematically converts each building's and lot's real-world latitude/longitude into flat x/y coordinates, preserving their true relative distances and directions, then scales the whole layout to fit the app's map view. This is why buildings on HokiePark's map sit in the same relative positions, at the same relative sizes, as they do on Virginia Tech's real campus.

**What's fully GIS-verified vs. visually estimated:** the large majority of the 92 buildings on the map — including all of the major, most-referenced buildings (Burruss Hall, Norris Hall, Squires Student Center, Torgersen Hall, Newman Library, War Memorial Gym and Chapel, the residence halls, Cassell Coliseum, Lane Stadium, and more) — have positions pulled directly from VT's official GIS records. A small number of buildings (about nine, including Saunders Hall, Smyth Hall, Steger Hall, Hitt Hall, and a few athletic and support buildings) were positioned by careful visual comparison against official VT campus map images rather than a direct GIS query, because of a data-fetching limitation encountered late in development; their relative position and size are a close visual match but not pixel-verified against the GIS source the way the others are.

**An honest caveat on building heights:** Virginia Tech's public GIS building data does not include a height or story-count field at all — it wasn't omitted from the app, it simply isn't part of what VT publishes. This is the main reason the map is intentionally 2D and schematic rather than a 3D model: doing 3D accurately would require data that doesn't exist in the public source, and inventing building heights would undermine the accuracy the rest of the map is built on.

**Live vs. static parking data:** garage occupancy (per-level counts) is currently realistic, hand-set demo data rather than a live sensor feed — Virginia Tech's real-time garage sensor systems were not accessible for integration during the hackathon. Static lot information (names, positions, permit types, ADA flags) is sourced from VT's real `ParkingLots` GIS layer. Section 12 describes how both would become fully live in a production deployment.

## 10. Visual & Brand Design

HokiePark's design deliberately borrows Virginia Tech's own visual language, so it reads as a campus-native tool rather than a generic third-party map app.

**Color system.** Rather than inventing a palette, the map reuses Virginia Tech's own official campus-map color-coding exactly: maroon for academic buildings, blue for residential and dining buildings, tan for student-life and support buildings (administrative offices, the library, the bookstore, the chapel, student centers), and peach for athletic facilities. A separate, distinct blue (`--ada`) marks accessible parking so it never gets confused with the residential-building blue. Virginia Tech's signature maroon and orange also appear in the app's UI chrome (buttons, highlights, active states), reinforcing the VT identity beyond just the map.

**Map legend.** A persistent legend explains every color and symbol on the map — the four building categories and the wheelchair symbol for ADA parking — so a first-time user (particularly a visitor, per the personas in Section 4) never has to guess what a color or icon means.

**Layout: the phone-frame interface.** The app is presented in a phone-shaped frame with the map as the primary view and a bottom sheet / list pattern for details — a layout familiar from mainstream map and transit apps, chosen so the interaction model needs no learning curve. Typography and spacing follow a clean, modern, high-contrast style intended to read clearly both indoors and in bright outdoor daylight (a real condition for an app used while walking to a car).

**Why this matters.** A parking app's job is to be trusted and used quickly, under time pressure, by people who may be unfamiliar with the campus. Visual consistency with VT's own official campus map — rather than a generic map skin — builds that trust immediately: it looks like it *belongs* to Virginia Tech, because its colors and data do.

## 11. Technical Architecture: How the Demo Is Actually Built

This section explains, in accessible terms, how the current hackathon build works under the hood.

**A single self-contained web app.** HokiePark's demo is one HTML file containing all of its markup, styling, and logic (HTML, CSS, and JavaScript together). This is a deliberate hackathon choice: it's simple to run, simple to share, and simple to iterate on quickly under time pressure, with no build process or server required to view it.

**The map itself is drawn with SVG** (Scalable Vector Graphics), a format for drawing shapes with code rather than pixels — which is why the map stays crisp at any zoom level and why buildings can be precisely positioned using real coordinate math (see Section 9) rather than a traced image.

**Data model.** Three JavaScript data structures drive everything shown on the map: a `BUILDINGS` list (92 entries, each with a name, category, and position/size), a `LOTS` list (85 static parking lots, including which have ADA spaces), and a `GARAGES` list (the two parking garages, each with per-level capacity, current occupancy, and ADA counts). The map, the detail sheets, the list view, and the AI assistant all read from these same three lists, so everything the user sees stays consistent no matter which part of the app they're looking at.

**Interactivity.** Panning, zooming, and the "fly-to" animation when selecting a garage or lot are handled with custom JavaScript operating directly on the SVG's coordinate system. The detail sheet is a sliding panel driven by the same underlying data objects. The AI assistant uses the Artifact platform's built-in AI-sampling capability (see Section 8) to answer natural-language questions using the app's own data as context.

**Why this architecture, for a hackathon.** The goal for VTHacks 14 was to prove the *experience* — an accurate, fast, trustworthy parking map — convincingly and quickly. A single-file, client-side app with realistic-but-static data achieves that without spending scarce hackathon time on backend infrastructure, databases, or live sensor integrations that weren't accessible during the event anyway. Section 12 describes the real, production-grade architecture this would grow into.

## 12. Production Vision: Building HokiePark on Databricks

The hackathon demo proves the *experience*; a real, campus-wide deployment would be powered by a proper data platform. This section lays out how HokiePark would be built for production using Databricks — directly answering the Deloitte × Databricks track's challenge to use a modern data platform as the backbone.

**The data problem in production.** A real deployment needs to continuously ingest live signals from multiple sources: physical occupancy sensors in Perry Street Garage and North End Center Garage (and any future garages), Virginia Tech's parking permit and enforcement systems, the same public GIS layers used for the demo's map (kept in sync as VT updates its records), and potentially crowd-sourced signals from the app's own users. Raw data like this arrives messy, inconsistent, and at varying speed — exactly the problem a data lakehouse platform like Databricks is built to solve.

**Delta Live Tables (DLT)** would manage the ingestion pipeline: continuously pulling in raw sensor and permit data, automatically cleaning and validating it (catching, for example, a sensor reporting an impossible occupancy count), and incrementally updating clean, ready-to-query tables of current garage and lot occupancy — replacing the demo's hand-set numbers with a real, always-current picture of every space on campus.

**Unity Catalog** would govern all of this data centrally: one consistent set of definitions for what a "garage," "lot," "level," and "ADA space" mean across every system that touches them, with proper access controls (so, for example, only authorized VT parking services systems can write occupancy updates) and full lineage tracking (so anyone can trace a number shown in the app back to its original sensor reading).

**Genie** would replace the demo's general-purpose AI sampling call (Section 8) with a purpose-built natural-language interface directly over the governed parking data in Unity Catalog — meaning the AI assistant's answers would be grounded in live, verified data rather than a fixed snapshot, and could safely answer more complex questions ("which garages have had space every day this week at 9am") that need real historical querying.

**MLflow** would support a predictive layer beyond "what's open right now": models trained on historical occupancy patterns (time of day, day of week, VT's academic calendar, weather, home football game days) could forecast *when* a garage is likely to fill up, letting HokiePark warn a user before they leave, not just report a full garage after the fact. MLflow would track and manage these models as they're trained, evaluated, and updated over time.

**Demo bridge: class-schedule-shaped occupancy (built, and how it maps to Databricks).** Until real sensor feeds exist, the demo's garage counts are *simulated*, but shaped by a real public signal: Virginia Tech's Timetable of Classes. The built pipeline is: one-time pull of the Fall 2026 timetable (5,317 timed meetings, 80 building codes, seat **capacity** per section) → map building codes to VT's GIS buildings using VT's official code list (99.1% of weekly seats placed) → for each garage, a 15-minute *class-activity index* (seats in session in buildings within 900 m, distance-weighted) → blend with a typical staff-workday shape by level type (commuter levels 90% class-driven, faculty/staff levels 25–35%) → per-level target curves for Monday–Friday → a database function that steps live counts toward "now"'s target. On a weekend, when the real timetable is empty, it replays a typical weekday. In the Databricks form, the same steps are a Delta pipeline (raw timetable → building dimension → 15-minute demand table in Unity Catalog), a scheduled Job that refreshes the targets, and an MLflow-tracked model of occupancy against class activity, with sensor data replacing the simulator when it is available. A working scaffold of that Databricks form is in the repo's `databricks/` folder (four notebooks, an Asset Bundle job, and a Python port of the model that is tested to reproduce the app's curves exactly); it has been exercised locally but not yet run on a live workspace. **Limits, stated plainly:** capacity is not enrollment, the blend weights are assumptions, both garages are mostly faculty/staff (so class density is a weak driver of their fill), and there is no sensor ground truth to validate against. A model trained on this simulated series would only recover the simulator's own formula, so any forecasting claim must wait for real occupancy history.

Together, this stack turns HokiePark from a well-designed static demo into a live, continuously learning system — the natural production form of the same product experience validated in the hackathon.

## 13. Roadmap

HokiePark's path from hackathon pilot to a full "Campus Life Intelligence Hub" is planned in four phases:

**Phase 1 — Hackathon pilot (VTHacks 14, current state).** A working demo proving the core experience: an accurate, VT-branded campus map built from real GIS data, live-feeling garage and lot occupancy, ADA accessibility indicators, and an AI parking assistant — all in a single, easily demoed web app.

**Phase 2 — Real data integration.** Connect to Virginia Tech's actual parking infrastructure: live occupancy sensors in Perry Street Garage and North End Center Garage, VT's permit and enforcement systems, and keep the map's building and lot data automatically synced with VT's live GIS services rather than a point-in-time snapshot. This is where the Databricks architecture from Section 12 (Delta Live Tables, Unity Catalog) would first come online.

**Phase 3 — Intelligence layer.** Add predictive capabilities on top of real historical data: forecasting when garages will fill based on time of day, class schedules, and campus events (home football games, move-in weekend); replacing the general AI assistant with Databricks Genie, grounded directly in governed, live parking data; and introducing personalization, like remembering a commuter student's usual permit zone.

**Phase 4 — Campus-wide Life Intelligence Hub.** Expand beyond parking into the fuller vision of the hackathon track: dining hall wait times and menus, study space and library seat availability, campus shuttle/bus tracking, and event and building-hours information — all built on the same governed Databricks data platform and presented through the same trustworthy, map-first interface style established by HokiePark's parking experience.

Each phase is designed to ship independently and add real value on its own, rather than requiring the full vision to be built before anything is useful — Phase 1 alone already solves a genuine, everyday campus problem.

## 14. Known Limitations & Open Questions

In the interest of giving a complete and honest picture, here is what the current build does not yet do, and what would need to be decided before moving toward production:

**Data limitations:**

- Garage occupancy is realistic, hand-set demo data, not a live sensor feed (Section 9, Section 12).
- Nine buildings' positions are visually estimated against official VT map images rather than pulled directly from a GIS query, due to a data-fetching reliability issue encountered during development (Section 9).
- Virginia Tech's public GIS building data has no height or story-count field, so true 3D building modeling isn't possible from this data source without an additional data source.
- ADA space counts are illustrative, not sourced from VT's official accessible-parking designations yet.

**Scope limitations:**

- No turn-by-turn driving directions to a chosen garage or lot.
- No permit purchase, payment, or citation/enforcement functionality.
- Not yet a compiled native mobile app (currently a responsive web app).

**Open questions for moving toward production:**

- Does Virginia Tech Parking Services have (or plan to install) real-time occupancy sensors in its garages and lots, and would they grant data access for a tool like HokiePark?
- What is the right process for keeping ADA space designations accurate and current as campus construction and lot changes happen over time?
- Should HokiePark integrate with VT's existing permit system (so a user only sees lots they're actually eligible to park in), or remain a general information layer on top of it?
- What is the right privacy and data-retention policy for any crowd-sourced or usage data HokiePark itself would collect in production?

These are flagged deliberately rather than glossed over — a credible production roadmap depends on having honest answers to them, not on pretending they're already solved.

## 15. Glossary

Plain-language definitions of terms used throughout this document, for readers without a technical or Virginia Tech background.

**ADA parking** — A parking space specifically designated for drivers with disabilities, under standards set by the Americans with Disabilities Act. Marked in HokiePark with a wheelchair symbol (♿).

**GIS (Geographic Information System)** — A system for storing and working with data tied to real-world locations — in this case, Virginia Tech's own official records of where its buildings and parking lots actually are.

**Databricks** — A data platform companies and institutions use to store, process, and analyze large amounts of data, and to build AI features on top of it. It's the platform this hackathon track asks teams to design around for production use.

**Delta Live Tables (DLT)** — A Databricks tool for automatically and continuously turning raw, messy incoming data (like sensor readings) into clean, reliable, up-to-date tables that an app can query.

**Unity Catalog** — Databricks' system for governing data: keeping consistent definitions, controlling who can access or change what, and tracking where every piece of data came from.

**Genie** — A Databricks feature that lets people ask questions about governed data in plain English and get accurate answers, without writing database queries themselves.

**MLflow** — A Databricks tool for building, tracking, and managing machine-learning models — in HokiePark's case, models that could predict when a garage is likely to fill up.

**Equirectangular projection** — A standard mathematical method for converting real-world latitude/longitude coordinates (which describe points on the curved Earth) into flat x/y coordinates for a 2D map, while preserving true relative distances and directions.

**SVG (Scalable Vector Graphics)** — A way of drawing images with code and math instead of a grid of pixels, which is why HokiePark's map stays sharp and precisely positioned at any zoom level.

**Persona** — A description of a type of user (see Section 4) used to design a product around real needs rather than assumptions.

## 16. Team & Hackathon Credits

HokiePark was built by a four-person team for **VTHacks 14**, held September 18–20, 2026, for the **Deloitte × Databricks "Campus Life Intelligence Hub"** track.

The build draws on Virginia Tech's own publicly available campus GIS data (building and parking-lot records from `arcgis-central.gis.vt.edu`), Virginia Tech's official campus map color and design conventions, and the Deloitte × Databricks track's challenge framing around data-driven campus life tools.

This spec is a living document — comments and edits from any team member are welcome directly on the sections above as the project continues to develop through and beyond the hackathon.
