# Databricks notebook source
# MAGIC %md
# MAGIC # 01 - Bronze: raw VT timetable meetings
# MAGIC Loads the one-time pull of VT's public **Timetable of Classes** (Fall 2026, Blacksburg) into a Delta table in Unity Catalog.
# MAGIC
# MAGIC * The file is `data/raw/timetable.json` from the HokiePark repo, uploaded to the volume `/Volumes/<catalog>/<schema>/raw/`.
# MAGIC   (Databricks Free Edition restricts outbound internet, so the pull happens once on a laptop with `npm run timetable`.)
# MAGIC * Each row is a weekly meeting slot: building code, days, start/end minute, and **seat capacity** (NOT enrollment).
# MAGIC * Source: VT Banner self-service timetable, public. Term: see the `term` column.

# COMMAND ----------

dbutils.widgets.text("catalog", "workspace", "Unity Catalog catalog")
dbutils.widgets.text("schema", "hokiepark", "Schema")
catalog = dbutils.widgets.get("catalog")
schema = dbutils.widgets.get("schema")
fq = f"`{catalog}`.`{schema}`"

spark.sql(f"CREATE SCHEMA IF NOT EXISTS {fq}")
spark.sql(f"CREATE VOLUME IF NOT EXISTS {fq}.raw")
spark.sql(f"CREATE VOLUME IF NOT EXISTS {fq}.out")
raw_dir = f"/Volumes/{catalog}/{schema}/raw"
print("expecting files in", raw_dir)

# COMMAND ----------

import json
import os

from pyspark.sql import functions as F

path = f"{raw_dir}/timetable.json"
if not os.path.exists(path):
    raise FileNotFoundError(f"{path} not found. Upload data/raw/timetable.json to the 'raw' volume (see databricks/README.md).")
with open(path) as f:
    raw = json.load(f)

rows = [(m["building"], m["days"], m["startMin"], m["endMin"], m["capacity"], m["sections"]) for m in raw["meetings"]]
# Basic quality gates: fail the job rather than publish an empty or broken table.
assert len(rows) > 1000, f"only {len(rows)} meeting groups - is this the full timetable?"
assert all(r[3] > r[2] for r in rows), "found a meeting that ends before it starts"
assert all(r[4] >= 0 for r in rows), "negative capacity"

df = (
    spark.createDataFrame(rows, "building string, days array<string>, start_min int, end_min int, capacity int, sections int")
    .withColumn("term", F.lit(raw["term"]))
    .withColumn("source", F.lit("VT Timetable of Classes (public); seat capacity, not enrollment"))
)
df.write.mode("overwrite").option("overwriteSchema", "true").saveAsTable(f"{fq}.bronze_timetable_meetings")
spark.sql(f"COMMENT ON TABLE {fq}.bronze_timetable_meetings IS 'Weekly meeting slots from the public VT timetable. capacity = seat cap, NOT enrollment.'")
print(f"wrote {len(rows)} meeting groups for term {raw['term']}")

# COMMAND ----------

display(spark.sql(f"SELECT building, SUM(capacity * size(days)) AS weekly_seats FROM {fq}.bronze_timetable_meetings GROUP BY building ORDER BY weekly_seats DESC LIMIT 10"))
