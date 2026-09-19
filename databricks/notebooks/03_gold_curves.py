# Databricks notebook source
# MAGIC %md
# MAGIC # 03 - Gold: per-level target occupancy curves
# MAGIC For each garage, seats in session in nearby buildings (900 m, squared distance falloff, cars arrive 15 min before and leave
# MAGIC 15 min after) give a 15-minute **class-activity index**. It is blended with an assumed staff-workday shape by level type
# MAGIC and levels fill bottom-up. The result is one target percent-full per level x weekday x 15-minute bucket.
# MAGIC
# MAGIC **These are SIMULATED targets, not measured occupancy.** Seat capacity is not headcount, the blend weights are assumptions,
# MAGIC and there is no sensor ground truth. The data is small (about 1,900 meeting slots), so the model runs on the driver via
# MAGIC `hokiepark_demand.py` (a tested Python port of the app's TypeScript model); Delta and Unity Catalog provide storage, lineage
# MAGIC and governance, not distributed compute.

# COMMAND ----------

dbutils.widgets.text("catalog", "workspace", "Unity Catalog catalog")
dbutils.widgets.text("schema", "hokiepark", "Schema")
catalog = dbutils.widgets.get("catalog")
schema = dbutils.widgets.get("schema")
fq = f"`{catalog}`.`{schema}`"
raw_dir = f"/Volumes/{catalog}/{schema}/raw"
out_dir = f"/Volumes/{catalog}/{schema}/out"

import json
import os
import sys

# The bundle syncs databricks/src next to notebooks/. Adjust if you import the notebooks another way.
sys.path.insert(0, os.path.abspath(os.path.join(os.getcwd(), "..", "src")))
import hokiepark_demand as hd

# COMMAND ----------

# Rebuild the meeting list from the silver table in a fixed order (same as the TypeScript build) so results are reproducible.
rows = spark.sql(f"""
SELECT building, days, start_min, end_min, capacity, sections, lat, lon
FROM {fq}.silver_meetings WHERE placed
""").collect()
placed = sorted(
    (
        {
            "group": {"building": r["building"], "days": list(r["days"]), "startMin": r["start_min"], "endMin": r["end_min"], "capacity": r["capacity"], "sections": r["sections"]},
            "lat": r["lat"],
            "lon": r["lon"],
        }
        for r in rows
    ),
    key=lambda p: (p["group"]["building"], p["group"]["startMin"], "".join(p["group"]["days"])),
)
garages = json.load(open(f"{raw_dir}/garages.json"))
curves = hd.build_level_curves(placed, garages)
print(f"{len(placed)} placed meeting slots -> {len(curves)} curves (level x weekday)")

# COMMAND ----------

from pyspark.sql import Row

spark.createDataFrame([Row(garage_id=c["garage_id"], level_index=c["level_index"], dow=c["dow"], pct=c["pct"]) for c in curves],
                      "garage_id string, level_index int, dow int, pct array<int>") \
    .write.mode("overwrite").option("overwriteSchema", "true").saveAsTable(f"{fq}.gold_level_curves")
spark.sql(f"COMMENT ON TABLE {fq}.gold_level_curves IS 'SIMULATED target occupancy percent per 15-minute bucket (96 values), shaped by the class timetable. Not sensor data. dow: ISO weekday 1=Mon..5=Fri.'")

# A tall, query-friendly view (this is what a Genie space or a dashboard would use).
spark.sql(f"""
CREATE OR REPLACE VIEW {fq}.gold_level_curves_by_time AS
SELECT garage_id, level_index, dow,
       pos AS bucket,
       lpad(CAST(floor(pos / 4) AS STRING), 2, '0') || ':' || lpad(CAST((pos % 4) * 15 AS STRING), 2, '0') AS time_of_day,
       v AS target_pct_full
FROM {fq}.gold_level_curves LATERAL VIEW posexplode(pct) t AS pos, v
""")

# COMMAND ----------

# The SQL the Supabase simulator consumes. Download it from the volume and run it in the Supabase SQL editor.
sql_path = f"{out_dir}/curves.seed.sql"
with open(sql_path, "w") as f:
    f.write(hd.render_seed_sql(curves))
print("wrote", sql_path)
display(spark.sql(f"SELECT * FROM {fq}.gold_level_curves_by_time WHERE garage_id = 'perry-street' AND level_index = 0 AND dow = 3 AND bucket BETWEEN 28 AND 48 ORDER BY bucket"))
