# Databricks notebook source
# MAGIC %md
# MAGIC # 07 - Batch score and export the lookup the app reads
# MAGIC Loads the **registered, versioned** forecaster from Unity Catalog and scores every place x weekday x 15-minute bucket once
# MAGIC (94 x 5 x 96 = 45,120 predictions). Writes `gold_predictions` (Delta) and `predictions.json` (volume file).
# MAGIC
# MAGIC **Why batch, not a live endpoint.** The model's input, the class timetable, barely changes within a day, so predictions can be
# MAGIC computed ahead of time. The app looks values up from the JSON in the browser, with no network call to Databricks at query time,
# MAGIC so a Databricks outage during a demo cannot break it. A live Model Serving endpoint is worth adding once real sensor data exists.
# MAGIC
# MAGIC **Consistency check.** For garage levels the forecast is compared with `gold_level_curves` (the curves the live Supabase feed
# MAGIC steers toward). They come from the same model family, so they must agree; a large gap means something drifted.

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
from datetime import datetime, timezone

import mlflow
import numpy as np
import pandas as pd

sys.path.insert(0, os.path.abspath(os.path.join(os.getcwd(), "..", "src")))
import hokiepark_ml as ml

user = spark.sql("SELECT current_user()").first()[0]
mlflow.set_experiment(f"/Users/{user}/hokiepark-occupancy-forecaster")
mlflow.set_registry_uri("databricks-uc")

# COMMAND ----------

model_name = f"{catalog}.{schema}.hokiepark_occupancy_forecaster"
client = mlflow.MlflowClient()
version = max(int(v.version) for v in client.search_model_versions(f"name='{model_name}'"))
model = mlflow.sklearn.load_model(f"models:/{model_name}/{version}")
features = spark.table(f"{fq}.sim_features").toPandas()
meta = spark.table(f"{fq}.sim_run_metadata").toPandas().iloc[0]
units = {u["id"]: u for u in json.load(open(f"{raw_dir}/units.json"))}

features["pct_pred"] = np.clip(np.rint(model.predict(ml.to_frame(features))), 0, 100).astype("int32")
print(f"scored {len(features):,} rows with {model_name} v{version}")

# COMMAND ----------

pred = features[["unit_id", "dow", "bucket", "pct_pred"]]
spark.createDataFrame(pred).write.mode("overwrite").option("overwriteSchema", "true").saveAsTable(f"{fq}.gold_predictions")
spark.sql(f"COMMENT ON TABLE {fq}.gold_predictions IS 'SIMULATION-TRAINED forecast of percent-full per place x weekday x 15-min bucket, from the registered hokiepark_occupancy_forecaster. Not measured occupancy.'")
unit_rows = pd.DataFrame([{"unit_id": u["id"], "name": u["name"], "kind": u["kind"], "capacity": u["capacity"], "classes": ",".join(u["classes"])} for u in units.values()])
spark.createDataFrame(unit_rows).write.mode("overwrite").option("overwriteSchema", "true").saveAsTable(f"{fq}.gold_prediction_units")

# COMMAND ----------

# Consistency with the live curves (garage levels only; lots have no live curve).
curves = spark.table(f"{fq}.gold_level_curves").toPandas()
diffs = []
by_key = {key: g.sort_values("bucket").pct_pred.to_numpy() for key, g in pred.groupby(["unit_id", "dow"])}
for r in curves.itertuples():
    p = by_key[(f"{r.garage_id}:{r.level_index}", r.dow)]
    diffs.append(np.abs(p - np.asarray(list(r.pct))))
diffs = np.concatenate(diffs)
consistency_mae, consistency_max = float(diffs.mean()), float(diffs.max())
print(f"forecast vs live curves (garage levels): MAE {consistency_mae:.2f} points, max {consistency_max:.0f}")
assert consistency_mae <= 6.0, "forecast has drifted from the live curves - investigate before shipping predictions.json"

# COMMAND ----------

payload = {
    "generated_at": datetime.now(timezone.utc).isoformat(),
    "kind": "SIMULATED",
    "disclaimer": "Forecast trained on Monte Carlo simulation of VT class-schedule demand; not measured occupancy and not validated against real sensors.",
    "term": str(meta["term"]),
    "model": {"name": model_name, "version": version},
    "sim": {"seed": int(meta["seed"]), "days_per_dow": int(meta["days_per_dow"])},
    "buckets": 96,
    "units": [
        {
            "id": uid,
            "name": units[uid]["name"],
            "kind": units[uid]["kind"],
            "capacity": units[uid]["capacity"],
            "pct": {str(d): g[g.dow == d].sort_values("bucket").pct_pred.astype(int).tolist() for d in range(1, 6)},
        }
        for uid, g in sorted(features.groupby("unit_id"), key=lambda kv: kv[0])
    ],
}
path = f"{out_dir}/predictions.json"
with open(path, "w") as f:
    json.dump(payload, f, separators=(",", ":"))
print("wrote", path, f"({os.path.getsize(path) / 1024:.0f} KB, {len(payload['units'])} places)")

with mlflow.start_run(run_name="batch-scoring"):
    mlflow.set_tags({"data_kind": "simulated", "validated": "false", "model_name": model_name, "model_version": str(version)})
    mlflow.log_metric("consistency_mae_vs_live_curves", consistency_mae)
    mlflow.log_metric("consistency_max_vs_live_curves", consistency_max)
    mlflow.log_metric("n_predictions", len(features))
    mlflow.log_artifact(path)

# COMMAND ----------

display(spark.sql(f"SELECT * FROM {fq}.gold_predictions WHERE unit_id = 'perry-street:0' AND dow = 3 AND bucket BETWEEN 30 AND 44 ORDER BY bucket"))
