"""
Training and evaluation helpers for the HokiePark occupancy forecaster (pandas + scikit-learn; no MLflow, no Spark).
Shared by notebooks 06 (train) and 07 (score) so both use exactly the same feature handling.

HONEST FRAMING. Labels come from the Monte Carlo simulator (`hokiepark_sim.py`), not from sensors, and the features are
deterministic functions of (place, weekday, time). Two consequences drive the evaluation design:
  1. On HELD-OUT DAYS (same places), a plain lookup of training-day averages is already near-optimal: the remaining error is
     the simulator's day-to-day noise, an irreducible floor. A model cannot beat it, and beating it is not the point.
  2. The question a model CAN answer is generalisation: predicting a place it has never seen, or a changed schedule, from
     its class-schedule features. So we also evaluate on HELD-OUT PLACES (whole lots removed from training), where no lookup
     exists and a place-agnostic average is the fair baseline.
Any number here measures recovery of the simulation, never real-world accuracy.
"""
from __future__ import annotations

import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.inspection import permutation_importance

import hokiepark_sim as hs

FEATURES = hs.FEATURE_COLUMNS
INT_FEATURES = ["dow", "minute", "is_garage_level"]
CLASS_FEATURES = hs.CLASS_FEATURES
BUSY = (540, 960)  # 9:00-16:00, the hours people plan around


def to_frame(df: pd.DataFrame, columns: list[str] | None = None) -> pd.DataFrame:
    """Model input with fixed dtypes (int64 / float64) so training, scoring and the MLflow signature agree."""
    cols = columns or FEATURES
    X = df[cols].copy()
    for c in cols:
        X[c] = X[c].astype("int64" if c in INT_FEATURES else "float64")
    return X


def new_model(seed: int = 0) -> HistGradientBoostingRegressor:
    return HistGradientBoostingRegressor(max_iter=200, learning_rate=0.1, max_leaf_nodes=63, random_state=seed)


def metrics(y: np.ndarray, p: np.ndarray, minute: np.ndarray | None = None) -> dict[str, float]:
    y, p = np.asarray(y, dtype=float), np.asarray(p, dtype=float)
    err = p - y
    ss_tot = float(((y - y.mean()) ** 2).sum())
    out = {"mae": float(np.abs(err).mean()), "rmse": float(np.sqrt((err**2).mean())), "r2": float(1 - (err**2).sum() / ss_tot) if ss_tot else 0.0}
    if minute is not None:
        m = (np.asarray(minute) >= BUSY[0]) & (np.asarray(minute) < BUSY[1])
        out["mae_busy_hours"] = float(np.abs(err[m]).mean()) if m.any() else float("nan")
    return out


def join_labels(labels: pd.DataFrame, features: pd.DataFrame) -> pd.DataFrame:
    df = labels.merge(features, on=["unit_id", "dow", "bucket"], how="inner", validate="many_to_one")
    if len(df) != len(labels):
        raise ValueError(f"{len(labels) - len(df)} label rows have no features (unit/dow/bucket mismatch)")
    return df


def split_days(df: pd.DataFrame, holdout_frac: float = 0.2) -> np.ndarray:
    """Boolean mask of TEST rows: the last `holdout_frac` of simulated days within each weekday (whole days, never partial)."""
    test_days = set()
    for _, g in df.groupby("dow"):
        days = sorted(g["day_id"].unique())
        k = max(1, int(round(len(days) * holdout_frac)))
        test_days.update(days[-k:])
    return df["day_id"].isin(test_days).to_numpy()


def split_places(units: list[dict], frac: float = 0.15, seed: int = 7) -> set[str]:
    """Ids of whole LOTS to hide from training. Garage levels stay in: their fill order is coupled within a garage."""
    lots = sorted(u["id"] for u in units if u["kind"] == "lot")
    rng = np.random.default_rng(seed)
    k = max(1, int(round(len(lots) * frac)))
    return set(rng.choice(lots, size=k, replace=False).tolist())


def lookup_baseline(train: pd.DataFrame, test: pd.DataFrame) -> np.ndarray:
    """Mean training-day label per (place, weekday, bucket): the natural 'no model' answer for places seen in training."""
    m = train.groupby(["unit_id", "dow", "bucket"])["pct"].mean().rename("p")
    return test.join(m, on=["unit_id", "dow", "bucket"])["p"].to_numpy()


def place_agnostic_baseline(train: pd.DataFrame, test: pd.DataFrame) -> np.ndarray:
    """Mean label per (weekday, bucket, garage-or-lot): all a lookup can offer for a place it has never seen."""
    m = train.groupby(["dow", "bucket", "is_garage_level"])["pct"].mean().rename("p")
    return test.join(m, on=["dow", "bucket", "is_garage_level"])["p"].to_numpy()


def evaluate(df: pd.DataFrame, units: list[dict], seed: int = 0) -> dict:
    """Both evaluations. Returns metrics per model per split, plus the held-out places and permutation importances."""
    no_class = [c for c in FEATURES if c not in CLASS_FEATURES]
    res: dict = {"held_out_days": {}, "held_out_places": {}}

    # A) held-out days, same places
    test_mask = split_days(df)
    tr, te = df[~test_mask], df[test_mask]
    res["held_out_days"]["n_train_rows"], res["held_out_days"]["n_test_rows"] = int(len(tr)), int(len(te))
    res["held_out_days"]["lookup_mean_of_training_days"] = metrics(te["pct"], lookup_baseline(tr, te), te["minute"])
    full = new_model(seed).fit(to_frame(tr), tr["pct"])
    res["held_out_days"]["forecaster_full_features"] = metrics(te["pct"], full.predict(to_frame(te)), te["minute"])
    abl = new_model(seed).fit(to_frame(tr, no_class), tr["pct"])
    res["held_out_days"]["forecaster_without_class_features"] = metrics(te["pct"], abl.predict(to_frame(te, no_class)), te["minute"])

    # B) held-out places: whole lots never seen in training
    hidden = split_places(units)
    pm = df["unit_id"].isin(hidden).to_numpy()
    tr, te = df[~pm], df[pm]
    res["held_out_places"]["places"] = sorted(hidden)
    res["held_out_places"]["n_train_rows"], res["held_out_places"]["n_test_rows"] = int(len(tr)), int(len(te))
    res["held_out_places"]["place_agnostic_average"] = metrics(te["pct"], place_agnostic_baseline(tr, te), te["minute"])
    full_b = new_model(seed).fit(to_frame(tr), tr["pct"])
    res["held_out_places"]["forecaster_full_features"] = metrics(te["pct"], full_b.predict(to_frame(te)), te["minute"])
    abl_b = new_model(seed).fit(to_frame(tr, no_class), tr["pct"])
    res["held_out_places"]["forecaster_without_class_features"] = metrics(te["pct"], abl_b.predict(to_frame(te, no_class)), te["minute"])

    # Which inputs matter, measured on the held-out-places model and a sample of its test rows
    sample = te.sample(n=min(5000, len(te)), random_state=seed)
    imp = permutation_importance(full_b, to_frame(sample), sample["pct"], n_repeats=3, random_state=seed, scoring="neg_mean_absolute_error")
    res["permutation_importance_mae_increase"] = {c: float(v) for c, v in sorted(zip(FEATURES, imp.importances_mean), key=lambda kv: -kv[1])}
    return res


def fit_final(df: pd.DataFrame, seed: int = 0) -> HistGradientBoostingRegressor:
    """The model that gets registered: refit on ALL simulated days and places (evaluation above used the splits)."""
    return new_model(seed).fit(to_frame(df), df["pct"])
