# Databricks notebook source
# MAGIC %md
# MAGIC # 06 - Train and evaluate the occupancy forecaster (MLflow)
# MAGIC **What it predicts.** Percent-full of a specific lot or garage level at a weekday and time, from features of the class schedule
# MAGIC around it (seats starting in the next 30 min, ended in the last 30, in session, distance-weighted), the time of day, the
# MAGIC place's size and fill order. **Model:** gradient-boosted trees (`HistGradientBoostingRegressor`).
# MAGIC
# MAGIC **What it is trained on.** `sim_training_labels`: simulated percent-full (notebook 05). Not sensor data.
# MAGIC
# MAGIC **How it is evaluated, and what the numbers mean.** Two splits, because one alone would mislead:
# MAGIC 1. **Held-out days** (same places): the simulator's day-to-day noise is an irreducible floor, and a plain average of training days is
# MAGIC    already near-optimal. The model should *match* it, not beat it.
# MAGIC 2. **Held-out places** (whole lots hidden from training): a lookup has nothing to offer, and a place-agnostic average is the fair baseline.
# MAGIC    This is where the model earns its keep: it can predict a place it never saw from that place's class-schedule features.
# MAGIC
# MAGIC An **ablation** (same model without the class-schedule features) shows whether the real timetable signal matters at all.
# MAGIC **All accuracy here measures recovery of the simulation. There is no real-world validation and none is claimed.**
# MAGIC The final model is refit on all days and places and registered in Unity Catalog.

# COMMAND ----------

dbutils.widgets.text("catalog", "workspace", "Unity Catalog catalog")
dbutils.widgets.text("schema", "hokiepark", "Schema")
catalog = dbutils.widgets.get("catalog")
schema = dbutils.widgets.get("schema")
fq = f"`{catalog}`.`{schema}`"
raw_dir = f"/Volumes/{catalog}/{schema}/raw"

import json
import os
import sys

import mlflow
import pandas as pd
from mlflow.models import infer_signature

sys.path.insert(0, os.path.abspath(os.path.join(os.getcwd(), "..", "src")))
import hokiepark_ml as ml

user = spark.sql("SELECT current_user()").first()[0]
mlflow.set_experiment(f"/Users/{user}/hokiepark-occupancy-forecaster")
mlflow.set_registry_uri("databricks-uc")

# COMMAND ----------

labels = spark.table(f"{fq}.sim_training_labels").toPandas()
features = spark.table(f"{fq}.sim_features").toPandas()
meta = spark.table(f"{fq}.sim_run_metadata").toPandas().iloc[0]
units = json.load(open(f"{raw_dir}/units.json"))
df = ml.join_labels(labels, features)
print(f"{len(df):,} training rows, {df.unit_id.nunique()} places, {df.day_id.nunique()} simulated days")

# COMMAND ----------

res = ml.evaluate(df, units)
for split in ("held_out_days", "held_out_places"):
    print(f"\n== {split}")
    for name, m in res[split].items():
        if isinstance(m, dict):
            print(f"  {name:38s} MAE {m['mae']:5.2f}  RMSE {m['rmse']:5.2f}  R2 {m['r2']:.3f}  busy-hours MAE {m['mae_busy_hours']:5.2f}")
print("\nwhat the model relies on (MAE increase when shuffled):", {k: round(v, 2) for k, v in list(res["permutation_importance_mae_increase"].items())[:6]})

# COMMAND ----------

final = ml.fit_final(df)
X_example = ml.to_frame(df.sample(n=5, random_state=0))
model_name = f"{catalog}.{schema}.hokiepark_occupancy_forecaster"
TAGS = {"data_kind": "simulated", "validated": "false", "label_source": "monte_carlo_over_vt_timetable", "term": str(meta["term"])}

with mlflow.start_run(run_name="forecaster-training") as run:
    mlflow.set_tags(TAGS)
    mlflow.log_params({
        "model": "HistGradientBoostingRegressor", "max_iter": 200, "learning_rate": 0.1, "max_leaf_nodes": 63,
        "sim_seed": int(meta["seed"]), "sim_days_per_dow": int(meta["days_per_dow"]), "n_places": int(meta["n_places"]),
        "n_label_rows": len(df), "features": ",".join(ml.FEATURES), "class_features": ",".join(ml.CLASS_FEATURES),
        "sim_distributions": str(meta["distributions"])[:500],
    })
    for split, prefix in (("held_out_days", "days"), ("held_out_places", "places")):
        for name, m in res[split].items():
            if isinstance(m, dict):
                for k, v in m.items():
                    mlflow.log_metric(f"{prefix}_{name}_{k}", v)
    for k, v in res["permutation_importance_mae_increase"].items():
        mlflow.log_metric(f"importance_{k}", v)
    mlflow.log_dict(res, "evaluation.json")
    info = mlflow.sklearn.log_model(
        final, artifact_path="model", signature=infer_signature(X_example, final.predict(X_example)),
        input_example=X_example, registered_model_name=model_name,
        serialization_format="cloudpickle",  # explicit: MLflow 3.x's default (skops) is not installed everywhere
    )
print("registered", model_name, info.model_uri)

# COMMAND ----------

# MAGIC %md
# MAGIC ### How to read the result
# MAGIC * **Held-out days:** forecaster ~ lookup. Both sit at the simulator's noise floor; that is expected and is not a claim of accuracy.
# MAGIC * **Held-out places:** forecaster vs place-agnostic average is the real test of generalisation. The gap to the no-class-features
# MAGIC   ablation is how much the real class timetable contributes *within the simulation*.
# MAGIC * The staff-workday shape dominates the importances because it is the largest term in the simulator itself, which is exactly
# MAGIC   the kind of thing to say out loud rather than hide.
