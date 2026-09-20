# HokiePark on Databricks: what the ML is for, what it trains on, and where the data comes from

**One sentence.** HokiePark's live map says what is open *now*; the forecaster answers *"what will this lot or garage level look like
when I get there at 2:00?"*, so a driver can pick a place before leaving, and the app can rank options for a specific class time.

**The honest headline.** There is no measured occupancy history for VT lots or garages, so the forecaster is trained on **simulated**
occupancy generated from **real** class-schedule data and **assumed** driver behaviour. Its accuracy numbers measure how well it
recovers that simulation, **not** real-world accuracy. Nothing here is validated against sensors, and no document, slide or demo
should imply it is.

## 1. Where the data comes from
| Data | Real, assumed or generated | Source | Where it lives |
| --- | --- | --- | --- |
| Class meetings: building, weekdays, start/end time, seat **capacity** | **Real** (capacity is a seat cap, not enrollment) | VT Timetable of Classes, public Banner page `selfservice.banner.vt.edu/ssb/HZSKVTSC.P_ProcRequest`; pulled once, politely, one request per subject (`npm run timetable`); Fall 2026 (`202609`), Blacksburg: 5,317 meetings | repo `data/raw/timetable.json` -> UC volume `raw/` -> Delta `bronze_timetable_meetings` |
| Timetable building code -> campus building | **Real** | VT's official code list (`hzskvtsc.P_DispBldgList`) matched to VT GIS building numbers; 71 codes, 99.1% of weekly seats placed; manual overrides recorded in a `how` column | `data/reference/timetable-building-codes.json` -> Delta `silver_building_dim` |
| Building, lot and garage coordinates, lot polygon areas | **Real** | VT's public ArcGIS layers (`arcgis-central.gis.vt.edu`, Buildings and ParkingLots) | `data/raw/*.raw.json`, exported as `building_points.json`, `units.json` |
| Which permit each lot / garage level is signed for | **Real, but incomplete** | VT Parking Services' 2026-27 Quick Guide and official parking map, encoded in `src/lib/permits.ts` and `src/data/*.ts` | `units.json` (`classes`). 66 of 85 lots have no known class; the model treats them neutrally |
| Lot capacities | **Estimated** | Derived from real GIS polygon area (no surface-lot capacity is published) | `units.json` |
| Garage level capacities and ADA counts | **Estimated / hand-set** | `src/data/garages.ts` (level classes follow VT's map; counts do not come from sensors) | `units.json` |
| How students and staff drive: arrival lead, departure lag, how many drive on a given day, staff arrival time, baseline fill, day-to-day noise | **Assumed** (labelled, tunable, in one table) | `DISTRIBUTIONS` in `databricks/src/hokiepark_sim.py` and `MODEL` in `databricks/src/hokiepark_demand.py` (mirrored in `src/lib/demand.ts`) | code |
| Occupancy labels the model trains on | **Generated** (Monte Carlo) | Notebook 05 | Delta `sim_training_labels` (902,400 rows for 20 simulated days per weekday) |
| Real occupancy from sensors | **None exists** | - | - |

## 2. How the training data is generated (notebook 05)
For each of 5 weekdays x 20 simulated days, the simulator draws fresh assumptions and computes percent-full for every one of 94 places
(85 lots + 9 garage levels) at every 15-minute bucket:
1. Each real class meeting adds "seats in session" to every place within 900 m, weighted by distance (squared falloff).
2. Each meeting gets its own random arrival lead (mean 15 min, sd 6, clipped 2-30) and departure lag (mean 15, sd 8, clipped 0-30), so demand spreads instead of spiking.
3. Each day scales class demand (mean 1.0, sd 0.15: how many students drive that day) and shifts the staff workday (sd 15 min).
4. The class-driven part is blended with an assumed staff-workday shape by who the place is signed for (commuter places follow classes ~90%, faculty/staff places ~25-35%).
5. Baseline and peak fill are jittered, then multiplicative day noise (sd 0.08) and per-place noise (sd 0.04) are applied. Garage levels fill bottom-up.

**Consistency guarantee, tested.** With all randomness switched off the simulator reproduces the live app's curves (`supabase/curves.seed.sql`)
to within rounding, so the forecast and the live feed describe the same world. Notebook 07 also checks the trained forecaster against the
live curves and fails if they drift (MAE 1.6 points in the local run).

**Mapping to the team's earlier spec** (`HokiePark - Class-Time Parking Recommender (Databricks ML Spec)`): the "20% commuter draw" and
attendance are folded into the day-level class scale (their absolute values cannot be identified without counts); the 60/25/15 permit mix
is expressed as each place's class weight; the timetable provides capacity, not enrollment, so "enrolled students" is seat capacity.

## 3. The model (notebook 06)
* **Target:** percent-full of a place at a weekday and 15-minute bucket.
* **Features:** seats (distance-weighted) starting in the next 30 min, ended in the last 30 min, and in session; time of day; typical staff-workday level; the place's class exposure, size, class weight, and fill order.
* **Algorithm:** gradient-boosted trees (`HistGradientBoostingRegressor`), tracked in MLflow, registered in Unity Catalog as `<catalog>.<schema>.hokiepark_occupancy_forecaster`.

## 4. How it is evaluated, and what the numbers mean
Two splits, because one alone would mislead. Full local run (902,400 label rows), mean absolute error in percentage points:

| Split | Lookup / average baseline | Forecaster, all features | Forecaster, no class features |
| --- | --- | --- | --- |
| **Held-out days**, same places | 2.41 (mean of training days) | 2.45 | 3.73 |
| **Held-out places**, 13 lots hidden from training | 7.30 (place-agnostic average) | **2.99** | 4.83 |

* On held-out **days** the forecaster only matches a plain lookup. That is expected: the remaining error is the simulator's own day-to-day noise, an irreducible floor. We do not claim it beats the lookup there.
* On held-out **places** a lookup has nothing to offer, and the model predicts lots it never saw from their class-schedule features (2.99 vs 7.30). This is the real ML result: **generalising to a new place or a changed schedule**.
* The **ablation** (same model without the class-schedule features) is 4.83 vs 2.99: within the simulation, the real timetable carries signal beyond time of day.
* Permutation importance is dominated by the assumed staff-workday shape (the simulator's biggest term), then class exposure. Say so rather than hide it.
* **What these numbers are not:** real-world accuracy. The labels come from our own simulator.

## 5. What reaches the app (notebook 07)
The registered model batch-scores every place x weekday x bucket (94 x 5 x 96 = 45,120 predictions) into Delta `gold_predictions` and a
131 KB `predictions.json` (marked `"kind": "SIMULATED"`, with the model name and version). **The app reads that file (shipped as `src/data/predictions.json`, the real workspace output of these notebooks); it never calls Databricks at
query time**, so an outage cannot break the demo. A live Model Serving endpoint is worth adding once real sensor data exists.

**Where you can see it in the app:** the **Plan** tab (building + day + class time + permit -> ranked options with forecast fullness and a Likely open / Filling up / Risky label) and Ask ("I have a 2pm class in Hancock Hall"). Only places the permit rules confirm are recommended.

## 6. Databricks components, and what each does here
| Component | Role |
| --- | --- |
| Delta tables (bronze / silver / gold) | Raw timetable -> building-joined meetings -> curves, simulation labels and predictions, with quality gates that fail the job |
| Unity Catalog | One governed schema: tables, volumes (`raw`, `out`), the registered model, comments stating "simulated" on every derived table |
| MLflow | Experiments for the assumption sweep and the forecaster (params, both evaluation splits, importances, tags `data_kind=simulated`, `validated=false`); model registry |
| Jobs / Asset Bundle | `databricks.yml` runs notebooks 01-07 in dependency order on serverless compute |
| Genie (optional, unverified on Free Edition) | Ad hoc questions over `gold_predictions_*` tables |

## 7. Limits and how they would be closed
* No ground truth: replace the simulated labels with real sensor counts when they exist and the same pipeline becomes a real forecast evaluation.
* Assumptions are placeholders, not sourced from VT Parking Services; swapping in real permit counts per tier or real garage counts is the highest-value calibration.
* Lot capacities are derived from polygon area and most lots have no known permit class: lot predictions are illustrative.
* The timetable is a public but unofficial-for-this-purpose page; it is pulled once and cached, never polled.
* Timetable capacity is not attendance; students with back-to-back classes are not modelled as individuals.

## 8. Run it
Upload the 5 files in `databricks/upload/` to the `raw` volume, then run notebooks 05 -> 06 -> 07 (01-04 must have run once). See `databricks/README.md`.
Local reproduction (no workspace): `npm run test:py` (needs pandas and scikit-learn for the ML tests).

## 9. Thirty-second version for judges
"We turned VT's public class timetable into a parking forecast on Databricks. There is no real occupancy data yet, so we simulate it:
real class times and buildings, randomised driver behaviour, 900,000 labelled examples in Delta. A gradient-boosted model, tracked and
registered in MLflow and Unity Catalog, learns to predict how full each lot is at any time, including lots it never saw during training.
It is honest about what it is: it recovers a simulation, not real occupancy, and the moment real sensor data exists the same pipeline
becomes a real forecast."
