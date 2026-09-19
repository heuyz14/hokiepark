# Databricks notebook source
# MAGIC %md
# MAGIC # 02 - Silver: building dimension and placed meetings
# MAGIC The timetable prints building **abbreviations** (`GBJ 104`); VT's GIS layer has building **numbers and coordinates**.
# MAGIC `timetable-building-codes.json` maps one to the other (from VT's official Banner code list `P_DispBldgList`, with a few
# MAGIC manual overrides recorded in its `how` column). This notebook builds `silver_building_dim` and marks each meeting as
# MAGIC placed / unplaced, then gates on coverage.

# COMMAND ----------

dbutils.widgets.text("catalog", "workspace", "Unity Catalog catalog")
dbutils.widgets.text("schema", "hokiepark", "Schema")
catalog = dbutils.widgets.get("catalog")
schema = dbutils.widgets.get("schema")
fq = f"`{catalog}`.`{schema}`"
raw_dir = f"/Volumes/{catalog}/{schema}/raw"

# COMMAND ----------

import json

codes = json.load(open(f"{raw_dir}/timetable-building-codes.json"))
points = json.load(open(f"{raw_dir}/building_points.json"))

dim_rows = []
for code, v in codes.items():
    p = points.get(v["num"])
    dim_rows.append((code, v.get("official"), v["num"], p["lat"] if p else None, p["lon"] if p else None, v["how"]))

spark.createDataFrame(dim_rows, "code string, official_name string, gis_bldg_num string, lat double, lon double, how string") \
    .write.mode("overwrite").option("overwriteSchema", "true").saveAsTable(f"{fq}.silver_building_dim")
spark.sql(f"COMMENT ON TABLE {fq}.silver_building_dim IS 'Timetable building code -> VT GIS building number and coordinates.'")

# COMMAND ----------

spark.sql(f"""
CREATE OR REPLACE TABLE {fq}.silver_meetings AS
SELECT m.building, m.days, m.start_min, m.end_min, m.capacity, m.sections, m.term,
       d.gis_bldg_num, d.lat, d.lon, (d.lat IS NOT NULL) AS placed
FROM {fq}.bronze_timetable_meetings m
LEFT JOIN {fq}.silver_building_dim d ON d.code = m.building
""")

cov = spark.sql(f"""
SELECT SUM(CASE WHEN placed THEN capacity * size(days) ELSE 0 END) AS placed_seats,
       SUM(capacity * size(days)) AS total_seats
FROM {fq}.silver_meetings
""").first()
ratio = cov["placed_seats"] / cov["total_seats"]
print(f"placed {cov['placed_seats']} of {cov['total_seats']} weekly seat-meetings ({ratio:.1%})")
assert ratio >= 0.98, "less than 98% of timetable seats map to a GIS building - check timetable-building-codes.json"

# COMMAND ----------

display(spark.sql(f"SELECT building, SUM(capacity * size(days)) AS weekly_seats FROM {fq}.silver_meetings WHERE NOT placed GROUP BY building ORDER BY weekly_seats DESC"))
