"""
Monte Carlo demand simulator + feature builder for the HokiePark occupancy forecaster (pure stdlib).

WHY THIS EXISTS. There is no measured occupancy history for VT lots or garages, so a forecaster cannot be trained on real
labels. Instead we generate labels from a REAL signal (which class meetings, in which buildings, at which times - VT's public
Timetable of Classes) plus ASSUMED human behaviour (how many students drive, when they arrive/leave, the staff workday), with
the assumptions randomised so no two simulated days are identical. The ML model then learns to predict this simulation from
features. What that gives us: an explainable, versioned, testable forecaster and a full Databricks pipeline. What it does NOT
give us: validated real-world accuracy. Every accuracy number measures how well the model recovers the simulation.

DESIGN. `simulate_day(..., deterministic=True)` reproduces `hokiepark_demand.build_level_curves` (the curves the live app uses)
exactly for garage levels; `deterministic=False` perturbs the assumptions per simulated day:
  * per-meeting arrival lead and departure lag ~ truncated normals (spreads demand instead of a one-minute spike)
  * a day-level scale on class demand (how many students drive that day: the commuter draw x attendance, relative to the baseline)
  * a staff arrival-time shift, peak/baseline fill jitter, and multiplicative day + place noise.
Lots use the same blend with a per-lot amplitude (`intensity`) from how much class seat exposure the lot has relative to the
busiest lots. Lot capacities are derived from GIS polygon area and most lots have no known permit class: predictions for them
are illustrative.
"""
from __future__ import annotations

import math
import random
from typing import Iterable

import hokiepark_demand as hd

BUCKETS = hd.BUCKETS
DOWS = hd.DOWS

# Share of a place's curve that follows class activity, by signed class (same meaning as MODEL["class_weight"]).
CLASS_WEIGHT = {
    "cg": 0.9, "graduate": 0.85, "student-remote": 0.9, "perry-cg": 0.9, "any-permit": 0.6,
    "fsv": 0.35, "fs-24": 0.25, "perry-fs": 0.25, "fs-remote": 0.1, "ada-service-24": 0.3,
}
UNKNOWN_CLASS_WEIGHT = 0.5

# Randomised assumptions: (mean, sd, low, high). Means of lead/lag equal the deterministic model's 15 min windows.
DISTRIBUTIONS = {
    "lead_min": (15.0, 6.0, 2.0, 30.0),  # cars arrive this long before class starts
    "lag_min": (15.0, 8.0, 0.0, 30.0),  # ... and leave this long after it ends
    "class_scale": (1.0, 0.15, 0.5, 1.5),  # commuter draw x attendance vs the baseline day
    "staff_shift_min": (0.0, 15.0, -45.0, 45.0),  # staff arrive earlier/later than the typical workday
    "peak_frac": (0.95, 0.02, 0.85, 1.0),
    "floor_frac": (0.04, 0.01, 0.0, 0.10),
    "day_noise": (1.0, 0.08, 0.7, 1.3),  # multiplicative, per simulated day
    "place_noise": (1.0, 0.04, 0.85, 1.15),  # multiplicative, per place per day
}


def truncated_normal(rng: random.Random, mean: float, sd: float, lo: float, hi: float) -> float:
    if sd <= 0:
        return min(hi, max(lo, mean))
    for _ in range(100):
        x = rng.gauss(mean, sd)
        if lo <= x <= hi:
            return x
    return min(hi, max(lo, mean))


def deterministic_params() -> dict:
    p = {k: v[0] for k, v in DISTRIBUTIONS.items()}
    p["lead_sd"], p["lag_sd"] = 0.0, 0.0
    return p


def draw_params(rng: random.Random) -> dict:
    """One simulated day's assumptions. lead/lag are per-meeting draws made in `simulate_day`; these are their spreads."""
    p = {k: truncated_normal(rng, *v) for k, v in DISTRIBUTIONS.items() if k not in ("lead_min", "lag_min")}
    p["lead_min"], p["lag_min"] = DISTRIBUTIONS["lead_min"][0], DISTRIBUTIONS["lag_min"][0]
    p["lead_sd"], p["lag_sd"] = DISTRIBUTIONS["lead_min"][1], DISTRIBUTIONS["lag_min"][1]
    return p


def unit_class_weight(u: dict) -> float:
    if u["kind"] == "garage-level":
        return hd.MODEL["class_weight"][hd.level_kind(u["classes"])]
    ws = [CLASS_WEIGHT[c] for c in u["classes"] if c in CLASS_WEIGHT]
    return sum(ws) / len(ws) if ws else UNKNOWN_CLASS_WEIGHT


def _window(g: dict, lead: float, lag: float) -> tuple[int, int]:
    first = max(0, math.floor((g["startMin"] - lead) / 15))
    last = min(BUCKETS - 1, math.floor((g["endMin"] + lag - 1) / 15))
    return first, last


def build_context(placed: list[dict], units: list[dict], model: dict = hd.MODEL) -> dict:
    """Everything that does not change between simulated days: pull weights, reference peaks, features, fill groups."""
    groups = [p["group"] for p in placed]
    locs: dict[tuple, dict] = {}
    for u in units:
        key = (u["lat"], u["lon"])
        if key in locs:
            continue
        loc = {"lat": u["lat"], "lon": u["lon"]}
        pulls = []
        for gi, p in enumerate(placed):
            w = hd.pull(hd.haversine_m(p, loc), model)
            if w > 0:
                pulls.append((gi, w))
        by_dow = {d: [(gi, w) for gi, w in pulls if any(hd.DAY_OF[x] == d for x in groups[gi]["days"])] for d in DOWS}
        rough = hd.raw_activity(placed, loc, model)
        smoothed = {d: hd.smooth(rough[d], model["smooth_buckets"]) for d in DOWS}
        nonzero = [v for d in DOWS for v in smoothed[d] if v > 0]
        p95 = max(1.0, hd.percentile(nonzero, 0.95))
        feats = {d: _features(groups, by_dow[d]) for d in DOWS}
        locs[key] = {"loc": loc, "pulls": by_dow, "p95": p95, "has_exposure": bool(nonzero), "features": feats}

    lot_p95 = sorted(l["p95"] for k, l in locs.items() if l["has_exposure"] and any(u["kind"] == "lot" and (u["lat"], u["lon"]) == k for u in units))
    lot_ref = lot_p95[min(len(lot_p95) - 1, int(0.9 * len(lot_p95)))] if lot_p95 else 1.0

    cascades: list[dict] = []
    garage_groups: dict[tuple, list[dict]] = {}
    for u in units:
        if u["kind"] == "garage-level":
            garage_groups.setdefault((u["garage_id"], hd.level_kind(u["classes"])), []).append(u)
        else:
            L = locs[(u["lat"], u["lon"])]
            intensity = min(1.0, L["p95"] / lot_ref) if L["has_exposure"] else 0.0
            cascades.append({"members": [u], "cw": unit_class_weight(u), "loc": (u["lat"], u["lon"]), "intensity": intensity})
    for members in garage_groups.values():
        members.sort(key=lambda m: m["level_index"])
        cascades.append({"members": members, "cw": unit_class_weight(members[0]), "loc": (members[0]["lat"], members[0]["lon"]), "intensity": 1.0})

    return {"groups": groups, "locs": locs, "cascades": cascades, "units": units, "model": model}


def _features(groups: list[dict], pulls: list[tuple[int, float]]) -> dict[str, list[float]]:
    """Deterministic class-schedule features per bucket for one place and weekday (seat-weighted by distance pull)."""
    upcoming = [0.0] * BUCKETS  # meetings starting in the next 30 min
    ended = [0.0] * BUCKETS  # meetings that ended in the last 30 min (departure pressure)
    insession = [0.0] * BUCKETS
    for gi, w in pulls:
        g = groups[gi]
        seats = g["capacity"] * w
        for b in range(BUCKETS):
            t = b * 15
            if t < g["startMin"] <= t + 30:
                upcoming[b] += seats
            if t - 30 <= g["endMin"] < t:
                ended[b] += seats
            if g["startMin"] <= t < g["endMin"]:
                insession[b] += seats
    return {"upcoming_30": upcoming, "ended_30": ended, "insession": insession}


def simulate_day(ctx: dict, dow: int, params: dict, rng: random.Random | None = None) -> dict[str, list[float]]:
    """One simulated day of percent-full per place per 15-minute bucket. `rng=None` requires zero-spread params."""
    groups, model = ctx["groups"], ctx["model"]
    day_leads: dict[int, float] = {}
    day_lags: dict[int, float] = {}

    def window_for(gi: int) -> tuple[float, float]:
        if gi not in day_leads:
            if rng is None or (params["lead_sd"] == 0 and params["lag_sd"] == 0):
                day_leads[gi], day_lags[gi] = params["lead_min"], params["lag_min"]
            else:
                day_leads[gi] = truncated_normal(rng, params["lead_min"], params["lead_sd"], *DISTRIBUTIONS["lead_min"][2:])
                day_lags[gi] = truncated_normal(rng, params["lag_min"], params["lag_sd"], *DISTRIBUTIONS["lag_min"][2:])
        return day_leads[gi], day_lags[gi]

    staff_scale = model["friday_staff_scale"] if dow == 5 else 1
    staff = [hd.staff_shape(b * 15 + 7 - params["staff_shift_min"]) * staff_scale for b in range(BUCKETS)]
    floor, peak_frac = params["floor_frac"], params["peak_frac"]
    raw_cache: dict[tuple, list[float]] = {}
    out: dict[str, list[float]] = {}

    for c in ctx["cascades"]:
        if c["loc"] not in raw_cache:
            arr = [0.0] * BUCKETS
            for gi, w in ctx["locs"][c["loc"]]["pulls"][dow]:
                g = groups[gi]
                first, last = _window(g, *window_for(gi))
                seats = g["capacity"] * w
                for b in range(first, last + 1):
                    arr[b] += seats
            raw_cache[c["loc"]] = hd.smooth(arr, model["smooth_buckets"])
        sm, p95 = raw_cache[c["loc"]], ctx["locs"][c["loc"]]["p95"]
        cw = c["cw"]
        noise = params["day_noise"] * (truncated_normal(rng, *DISTRIBUTIONS["place_noise"]) if rng is not None else 1.0)
        total_cap = sum(m["capacity"] for m in c["members"])
        occ = [[0.0] * BUCKETS for _ in c["members"]]
        for b in range(BUCKETS):
            activity = min(1.0, c["intensity"] * params["class_scale"] * sm[b] / p95)
            frac = floor + (peak_frac - floor) * (cw * activity + (1 - cw) * staff[b])
            remaining = min(1.0, frac * noise) * total_cap
            for k, m in enumerate(c["members"]):
                take = min(m["capacity"], remaining)
                occ[k][b] = take
                remaining -= take
        for k, m in enumerate(c["members"]):
            out[m["id"]] = [100.0 * o / m["capacity"] for o in occ[k]]
    return out


def feature_table(ctx: dict) -> dict[str, list]:
    """Column-oriented features for every (place, weekday, bucket); one row each. Same function used to train and to score."""
    cols: dict[str, list] = {k: [] for k in (
        "unit_id", "dow", "bucket", "minute", "staff_shape", "upcoming_30", "ended_30", "insession",
        "exposure", "intensity", "capacity", "class_weight", "is_garage_level", "fill_pos", "group_cap",
    )}
    for c in ctx["cascades"]:
        L = ctx["locs"][c["loc"]]
        group_cap = sum(m["capacity"] for m in c["members"])
        before = 0
        for m in c["members"]:
            fill_pos = before / group_cap
            before += m["capacity"]
            for d in DOWS:
                f = L["features"][d]
                for b in range(BUCKETS):
                    cols["unit_id"].append(m["id"])
                    cols["dow"].append(d)
                    cols["bucket"].append(b)
                    cols["minute"].append(b * 15)
                    cols["staff_shape"].append(hd.staff_shape(b * 15 + 7) * (hd.MODEL["friday_staff_scale"] if d == 5 else 1))
                    cols["upcoming_30"].append(f["upcoming_30"][b])
                    cols["ended_30"].append(f["ended_30"][b])
                    cols["insession"].append(f["insession"][b])
                    cols["exposure"].append(L["p95"] if L["has_exposure"] else 0.0)
                    cols["intensity"].append(c["intensity"])
                    cols["capacity"].append(m["capacity"])
                    cols["class_weight"].append(c["cw"])
                    cols["is_garage_level"].append(1 if m["kind"] == "garage-level" else 0)
                    cols["fill_pos"].append(fill_pos)
                    cols["group_cap"].append(group_cap)
    return cols


FEATURE_COLUMNS = ["dow", "minute", "staff_shape", "upcoming_30", "ended_30", "insession", "exposure", "intensity", "capacity",
                   "class_weight", "is_garage_level", "fill_pos", "group_cap"]
# Columns that carry the class-schedule signal; dropping them is the ablation ("does the timetable help at all?").
CLASS_FEATURES = ["upcoming_30", "ended_30", "insession", "exposure", "intensity"]


def simulate_training_set(ctx: dict, days_per_dow: int = 15, seed: int = 20260919) -> dict[str, list]:
    """Labels: `days_per_dow` random days for each weekday. Column-oriented; `day_id` groups rows for held-out evaluation."""
    rng = random.Random(seed)
    cols: dict[str, list] = {k: [] for k in ("day_id", "dow", "unit_id", "bucket", "pct")}
    day_params: list[dict] = []
    day_id = 0
    for d in DOWS:
        for _ in range(days_per_dow):
            params = draw_params(rng)
            traces = simulate_day(ctx, d, params, rng)
            for uid, pct in traces.items():
                for b, v in enumerate(pct):
                    cols["day_id"].append(day_id)
                    cols["dow"].append(d)
                    cols["unit_id"].append(uid)
                    cols["bucket"].append(b)
                    cols["pct"].append(round(min(100.0, max(0.0, v)), 1))
            day_params.append({"day_id": day_id, "dow": d, **{k: round(v, 4) for k, v in params.items()}})
            day_id += 1
    cols["_day_params"] = day_params  # type: ignore[assignment]
    return cols


def mean_curve(ctx: dict, dow: int) -> dict[str, list[float]]:
    """The deterministic (zero-randomness) day: what the live app's curves show, per place."""
    return simulate_day(ctx, dow, deterministic_params(), None)


def unit_ids(units: Iterable[dict]) -> list[str]:
    return [u["id"] for u in units]
