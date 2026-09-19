# HokiePark on Databricks (Tier B)

The same class-schedule occupancy pipeline the app runs locally, expressed as Delta tables in Unity Catalog, tracked in MLflow,
and exported as the SQL the Supabase simulator consumes. For the VTHacks 14 Deloitte x Databricks track.

**Outputs are SIMULATED.** The timetable gives seat *capacity* (not enrollment), the blend weights are assumptions, and there is no
sensor ground truth. Nothing here is a validated forecast; every MLflow run is tagged `data_kind=simulated`, `validated=false`.

```
VT Timetable (public)  --npm run timetable (laptop, once)-->  timetable.json
        upload 4 files to volume  /Volumes/<catalog>/<schema>/raw/
01_bronze_timetable   -> bronze_timetable_meetings      (Delta, quality gates)
02_silver_buildings   -> silver_building_dim, silver_meetings   (code -> GIS building; gate: >= 98% of seats placed)
03_gold_curves        -> gold_level_curves, gold_level_curves_by_time (view), and out/curves.seed.sql (volume file)
04_mlflow_track       -> experiment runs + sensitivity sweep, registered model <catalog>.<schema>.hokiepark_occupancy_target
        download out/curves.seed.sql  ->  run it in the Supabase SQL editor
```

## Files
| Path | What |
| --- | --- |
| `notebooks/01..04_*.py` | Databricks source-format notebooks (import via Workspace -> Import, or deploy the bundle) |
| `src/hokiepark_demand.py` | Pure-Python port of `src/lib/demand.ts`; the notebooks call it |
| `databricks.yml` | Asset Bundle: one serverless job running the four notebooks in order |
| `data/garages.json`, `data/building_points.json` | Generated inputs (`npm run databricks:inputs`) |
| `tests/test_parity.py` | Proves the Python model reproduces `supabase/curves.seed.sql` byte for byte (`npm run test:py`) |

## Setup (about 20 minutes, needs a Databricks workspace)
Free Edition is enough (free signup at databricks.com). It is serverless-only, restricts outbound internet to trusted domains, and
expects files in Unity Catalog **volumes**, not DBFS ([limits](https://docs.databricks.com/aws/en/getting-started/free-edition-limitations)).
That is why the notebooks read uploaded files instead of scraping VT or calling Supabase.

1. **Find your catalog name** in the Catalog explorer. The notebooks default to `workspace`; if yours differs, change the `catalog` widget (or `--var catalog=...` in the bundle).
2. **Run notebook 01 once** (it creates the schema and the `raw` and `out` volumes and then stops with "file not found").
3. **Upload four files** to the `raw` volume (Catalog -> your schema -> Volumes -> raw -> Upload to this volume):
   `data/raw/timetable.json`, `data/timetable-building-codes.json`, `databricks/data/building_points.json`, `databricks/data/garages.json`.
4. **Run the notebooks in order** 01 -> 04 (attach to serverless), or from a terminal with the Databricks CLI signed in:
   `cd databricks && databricks bundle validate && databricks bundle deploy && databricks bundle run hokiepark_curves`.
5. **Get the SQL into Supabase:** download `out/curves.seed.sql` from the `out` volume and run it in the Supabase SQL editor. It is
   identical to the repo's `supabase/curves.seed.sql` while the model parameters match.
6. **Optional, for the demo:** point a dashboard or a Genie space at `gold_level_curves_by_time` ("when does Perry Level 1 fill on a
   Wednesday?"). Whether Genie is enabled on Free Edition is unconfirmed; check before promising it.

Regenerate inputs after changing the app's garages: `npm run databricks:inputs`. Your assistant can use Databricks' published
skills for this work; see the top-level `ai-dev-kit/README.md` (it installs through the Databricks CLI, not from this repo).

## What was verified, and what was not
Verified locally before the workspace run (2026-09-19):
- `npm run test:py`: 9 tests, including exact match with the TypeScript-generated curves, the notebooks' sort order, and half-up rounding.
- Notebook 04 executed end to end against a fake `spark`/`dbutils` with real MLflow (3.16, local store): 9 runs logged with tags and
  metrics, model registered, and `predict` returns 95 for Perry Level 1, Wednesday 10:30 (matches the curve).
- All notebooks parse; `databricks.yml` structure checks (task graph, paths, notebook headers).

**Run on a real Databricks Free Edition workspace (2026-09-19):** notebooks 01-04 ran to completion, including the Spark table
writes, the volume paths and the MLflow model registration. The `out/curves.seed.sql` the workspace produced matched
`supabase/curves.seed.sql` on every line after the header comment (45 rows).

**Still not verified:** `databricks bundle deploy` (the workspace was driven by hand, not through `databricks.yml`) and Genie
availability on Free Edition.
A bug found by the local run and already fixed: MLflow 3.x could not infer the model signature and handed `predict` one column, so
the signature is declared explicitly.

## Findings worth saying in the pitch
- The sensitivity sweep (radius 600/900/1200 m x commuter class weight 0.7/0.9) moves the curves by under 0.5 percentage points on
  average, and the commuter level's hours at or above 90% only between 5.25 and 6.25. The output is dominated by the assumed staff
  workday and the fill cap, not by the class-driven part. That is an honest limit of a simulation with no ground truth.
- Timetable coverage: 99.1% of weekly seats land on a GIS building.
- With real sensor history, replace `03_gold_curves` with a forecast and keep `04_mlflow_track` as the evaluation harness.
