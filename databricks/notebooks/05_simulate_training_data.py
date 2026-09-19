# Databricks notebook source
# MAGIC %md
# MAGIC # 05 - Simulate training data (Monte Carlo)
# MAGIC **Why.** There is no measured occupancy history for VT lots or garages, so a forecaster cannot be trained on real labels.
# MAGIC We generate labels from a **real signal** plus **assumed behaviour**, with the assumptions randomised so no two days match:
# MAGIC
# MAGIC | Ingredient | Source | Real or assumed |
# MAGIC | --- | --- | --- |
# MAGIC | Which classes meet where and when, and their seat capacity | VT Timetable of Classes (public), `silver_meetings` | **Real** (capacity, not enrollment) |
# MAGIC | Building and lot/garage locations, lot areas | VT GIS (public ArcGIS layers) | **Real** |
# MAGIC | Which permit each lot/garage level is signed for | VT parking map / Quick Guide (encoded in the app) | **Real** (66 of 85 lots have no known class) |
# MAGIC | Lot capacities | Derived from GIS polygon area | **Estimated** |
# MAGIC | Arrival lead, departure lag, how many students drive that day, staff arrival time, baseline fill, day noise | `hokiepark_sim.DISTRIBUTIONS` | **Assumed** |
# MAGIC
# MAGIC Each simulated day draws fresh assumptions and produces percent-full for every place (94: 85 lots + 9 garage levels) at every
# MAGIC 15-minute bucket. With all randomness off, the simulator reproduces the app's live curves exactly (tested), so the forecast and the
# MAGIC live feed agree. **The labels are simulated, not measured.** Everything downstream inherits that.
# MAGIC
# MAGIC Writes `sim_features` (deterministic class-schedule features per place/weekday/bucket), `sim_training_labels` (simulated
# MAGIC percent-full per day) and `sim_run_metadata` / `sim_day_params` (which random draws produced this set).

# COMMAND ----------

dbutils.widgets.text("catalog", "workspace", "Unity Catalog catalog")
dbutils.widgets.text("schema", "hokiepark", "Schema")
dbutils.widgets.text("days_per_dow", "20", "Simulated days per weekday")
dbutils.widgets.text("seed", "20260919", "Random seed")
catalog = dbutils.widgets.get("catalog")
schema = dbutils.widgets.get("schema")
days_per_dow = int(dbutils.widgets.get("days_per_dow"))
seed = int(dbutils.widgets.get("seed"))
fq = f"`{catalog}`.`{schema}`"
raw_dir = f"/Volumes/{catalog}/{schema}/raw"

import json
import os
import sys
from datetime import datetime, timezone

import pandas as pd

sys.path.insert(0, os.path.abspath(os.path.join(os.getcwd(), "..", "src")))
import hokiepark_sim as hs

# COMMAND ----------

rows = spark.sql(f"SELECT building, days, start_min, end_min, capacity, sections, lat, lon FROM {fq}.silver_meetings WHERE placed").collect()
placed = sorted(
    (
        {"group": {"building": r["building"], "days": list(r["days"]), "startMin": r["start_min"], "endMin": r["end_min"], "capacity": r["capacity"], "sections": r["sections"]}, "lat": r["lat"], "lon": r["lon"]}
        for r in rows
    ),
    key=lambda p: (p["group"]["building"], p["group"]["startMin"], "".join(p["group"]["days"])),
)
units = json.load(open(f"{raw_dir}/units.json"))
term = json.load(open(f"{raw_dir}/timetable.json"))["term"]
ctx = hs.build_context(placed, units)
print(f"{len(placed)} placed meeting slots, {len(units)} places ({sum(u['kind'] == 'lot' for u in units)} lots)")

# COMMAND ----------

features = pd.DataFrame(hs.feature_table(ctx))
spark.createDataFrame(features).write.mode("overwrite").option("overwriteSchema", "true").saveAsTable(f"{fq}.sim_features")
spark.sql(f"COMMENT ON TABLE {fq}.sim_features IS 'Deterministic class-schedule features per place x weekday x 15-min bucket, from the real VT timetable. No randomness.'")
print("sim_features:", len(features), "rows")

# COMMAND ----------

ts = hs.simulate_training_set(ctx, days_per_dow=days_per_dow, seed=seed)
day_params = pd.DataFrame(ts.pop("_day_params"))
labels = pd.DataFrame(ts).astype({"day_id": "int32", "dow": "int32", "bucket": "int32", "pct": "float32"})
spark.createDataFrame(labels).write.mode("overwrite").option("overwriteSchema", "true").saveAsTable(f"{fq}.sim_training_labels")
spark.createDataFrame(day_params).write.mode("overwrite").option("overwriteSchema", "true").saveAsTable(f"{fq}.sim_day_params")
spark.sql(f"COMMENT ON TABLE {fq}.sim_training_labels IS 'SIMULATED percent-full per simulated day x place x 15-min bucket (Monte Carlo over the real timetable). NOT measured occupancy.'")
spark.sql(f"COMMENT ON TABLE {fq}.sim_day_params IS 'The random assumptions drawn for each simulated day (lead/lag spreads, class scale, staff shift, noise).'")

meta = pd.DataFrame([{
    "created_at": datetime.now(timezone.utc).isoformat(), "term": str(term), "seed": seed, "days_per_dow": days_per_dow,
    "n_places": len(units), "n_label_rows": len(labels),
    "distributions": json.dumps({k: list(v) for k, v in hs.DISTRIBUTIONS.items()}),
    "data_kind": "simulated", "validated": False,
}])
spark.createDataFrame(meta).write.mode("overwrite").option("overwriteSchema", "true").saveAsTable(f"{fq}.sim_run_metadata")
print(f"sim_training_labels: {len(labels):,} rows = {days_per_dow * 5} simulated days x {len(units)} places x 96 buckets")

# COMMAND ----------

# Sanity check: the simulated Wednesday should have the commuter level (Perry Level 1) filling during class hours.
w = labels[(labels.unit_id == "perry-street:0") & (labels.dow == 3)].groupby("bucket").pct.agg(["mean", "std"]).round(1)
display(spark.createDataFrame(w.loc[[28, 32, 36, 40, 44, 48, 56, 64, 72]].reset_index()))
