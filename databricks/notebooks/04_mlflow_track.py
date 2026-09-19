# Databricks notebook source
# MAGIC %md
# MAGIC # 04 - MLflow: track the demand model and its assumptions
# MAGIC **What this is, honestly.** The curves are a hand-parameterised *simulation*, so there is nothing here to "train" or to validate
# MAGIC against ground truth. MLflow is used for what it is good at anyway:
# MAGIC 1. **Experiment tracking of the assumptions.** Every run records the model parameters, timetable coverage and headline
# MAGIC    outputs, and a small **sensitivity sweep** shows how much the answer moves when an assumption changes (radius, class weight).
# MAGIC 2. **A registered, versioned artifact** (`hokiepark_occupancy_target`) that returns the target percent-full for a garage level
# MAGIC    at a weekday and time, so the app, a dashboard or a Genie space can call one governed thing.
# MAGIC 3. Once real occupancy history exists (sensors), the same experiment becomes a real forecast evaluation. Until then, every
# MAGIC    run is tagged `data_kind=simulated` and `validated=false`.

# COMMAND ----------

dbutils.widgets.text("catalog", "workspace", "Unity Catalog catalog")
dbutils.widgets.text("schema", "hokiepark", "Schema")
catalog = dbutils.widgets.get("catalog")
schema = dbutils.widgets.get("schema")
fq = f"`{catalog}`.`{schema}`"
raw_dir = f"/Volumes/{catalog}/{schema}/raw"

import copy
import json
import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.getcwd(), "..", "src")))
import hokiepark_demand as hd
import mlflow

user = spark.sql("SELECT current_user()").first()[0]
mlflow.set_experiment(f"/Users/{user}/hokiepark-occupancy-curves")
mlflow.set_registry_uri("databricks-uc")

# COMMAND ----------

rows = spark.sql(f"SELECT building, days, start_min, end_min, capacity, sections, lat, lon FROM {fq}.silver_meetings WHERE placed").collect()
placed = sorted(
    (
        {"group": {"building": r["building"], "days": list(r["days"]), "startMin": r["start_min"], "endMin": r["end_min"], "capacity": r["capacity"], "sections": r["sections"]}, "lat": r["lat"], "lon": r["lon"]}
        for r in rows
    ),
    key=lambda p: (p["group"]["building"], p["group"]["startMin"], "".join(p["group"]["days"])),
)
garages = json.load(open(f"{raw_dir}/garages.json"))
timetable_meta = json.load(open(f"{raw_dir}/timetable.json"))
codes = json.load(open(f"{raw_dir}/timetable-building-codes.json"))
points = json.load(open(f"{raw_dir}/building_points.json"))
placed_seats, total_seats = hd.coverage(timetable_meta["meetings"], codes, points)

TAGS = {"data_kind": "simulated", "validated": "false", "seat_measure": "capacity_not_enrollment", "term": str(timetable_meta["term"])}


def flat_params(model):
    out = {k: v for k, v in model.items() if k != "class_weight"}
    out.update({f"class_weight_{k}": v for k, v in model["class_weight"].items()})
    return out


def run_once(model, name, nested=False, baseline=None):
    curves = hd.build_level_curves(placed, garages, model)
    with mlflow.start_run(run_name=name, nested=nested):
        mlflow.set_tags(TAGS)
        mlflow.log_params(flat_params(model))
        mlflow.log_metric("timetable_seat_coverage", placed_seats / total_seats)
        for s in hd.summarize(curves, garages, dow=3):
            g = s["garage_id"].replace("-", "_")
            mlflow.log_metric(f"{g}_wed_peak_fill_pct", s["peak_fill_pct"])
            mlflow.log_metric(f"{g}_wed_peak_hour", s["peak_hour"])
            mlflow.log_metric(f"{g}_wed_hours_ge_90", s["hours_at_or_above_90"])
            mlflow.log_metric(f"{g}_wed_max_15min_change", s["max_15min_change"])
        # Whole-garage peaks saturate at the fill cap, so also log metrics that can actually move with the assumptions:
        # the class-driven commuter level on its own, and how far every curve moved from the baseline.
        mlflow.log_metric("perry_commuter_level_wed_hours_ge_90", hd.level_hours_at_or_above(curves, "perry-street", 0))
        mlflow.log_metric("mean_abs_change_vs_baseline_pct_points", hd.mean_abs_diff(curves, baseline) if baseline else 0.0)
        return curves


# COMMAND ----------

# Baseline run (the parameters the app ships with) + a sensitivity sweep as nested runs.
with mlflow.start_run(run_name="baseline-and-sweep") as parent:
    mlflow.set_tags(TAGS)
    base_curves = run_once(hd.MODEL, "baseline", nested=True)
    for radius in (600, 900, 1200):
        for commuter_weight in (0.7, 0.9):
            m = copy.deepcopy(hd.MODEL)
            m["radius_m"] = radius
            m["class_weight"]["cg"] = commuter_weight
            run_once(m, f"radius={radius}m cg_weight={commuter_weight}", nested=True, baseline=base_curves)
    parent_run_id = parent.info.run_id
print("experiment runs logged; parent run", parent_run_id)

# COMMAND ----------

import pandas as pd
from mlflow.models import ModelSignature
from mlflow.types import ColSpec, Schema


class OccupancyTarget(mlflow.pyfunc.PythonModel):
    """target percent-full for (garage_id, level_index, dow 1-5, minute 0-1439). SIMULATED, not measured."""

    def load_context(self, context):
        with open(context.artifacts["curves"]) as f:
            self.table = {(c["garage_id"], c["level_index"], c["dow"]): c["pct"] for c in json.load(f)}

    def predict(self, context, model_input, params=None):
        out = []
        for _, r in model_input.iterrows():
            pct = self.table[(str(r["garage_id"]), int(r["level_index"]), int(r["dow"]))]
            out.append(pct[min(95, int(r["minute"]) // 15)])
        return pd.DataFrame({"target_pct_full": out})


curves_path = "/tmp/curves.json"
with open(curves_path, "w") as f:
    json.dump(base_curves, f)
example = pd.DataFrame({"garage_id": ["perry-street"], "level_index": [0], "dow": [3], "minute": [630]}).astype({"level_index": "int64", "dow": "int64", "minute": "int64"})
model_name = f"{catalog}.{schema}.hokiepark_occupancy_target"
# Explicit signature (not inferred): MLflow 3.x can fail to infer one and then hands predict() a single column.
signature = ModelSignature(
    inputs=Schema([ColSpec("string", "garage_id"), ColSpec("long", "level_index"), ColSpec("long", "dow"), ColSpec("long", "minute")]),
    outputs=Schema([ColSpec("long", "target_pct_full")]),
)

with mlflow.start_run(run_name="register-occupancy-target"):
    mlflow.set_tags(TAGS)
    info = mlflow.pyfunc.log_model(
        artifact_path="model",
        python_model=OccupancyTarget(),
        artifacts={"curves": curves_path},
        signature=signature,
        input_example=example,
        registered_model_name=model_name,
    )
print("registered", model_name, info.model_uri)

# COMMAND ----------

# Smoke test the registered artifact: Perry Level 1 (the commuter level) on Wednesday at 10:30 should be near its daily peak.
loaded = mlflow.pyfunc.load_model(info.model_uri)
print(loaded.predict(example))
