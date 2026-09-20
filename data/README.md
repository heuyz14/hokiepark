# Data

| Folder | Contents | How it is made |
| --- | --- | --- |
| `raw/` | Unmodified pulls: `buildings.raw.json`, `parkinglots.raw.json` (VT ArcGIS, WGS84), `timetable.json` (VT Timetable of Classes, capacity not enrollment) | `scripts/data/fetch-gis.ts`, `scripts/data/fetch-timetable.ts`; committed so the app and tests never touch the network |
| `reference/` | Hand-curated lookups: `timetable-building-codes.json` (timetable code -> GIS building, from VT's official code list), `vt_parking_app_dataset.csv` (facts from VT's parking pages, used by comments and `src/data`) | edited by hand; every change should say where it came from |

Derived data lives elsewhere: `src/data/*.json` (from `raw/` via `npm run data`), `supabase/*.sql` and `databricks/data/*` (generated, see `scripts/README.md`).
