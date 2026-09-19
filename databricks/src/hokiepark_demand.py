"""
Class-schedule-shaped garage occupancy curves - Python port of src/lib/demand.ts (pure stdlib, no Spark, no pandas).

The Databricks notebooks store and govern the data in Delta / Unity Catalog and call this module for the (tiny) computation.
`databricks/tests/test_parity.py` checks that this port reproduces supabase/curves.seed.sql, which the TypeScript build
generates, byte for byte. Change the model in ONE place, then update the other and re-run that test.

WHAT THIS IS: a transparent, hand-parameterised model (seat capacity in session near a garage, blended with an assumed
staff-workday shape). WHAT IT IS NOT: measured occupancy, enrollment, or a validated forecast. Say so wherever it is shown.
"""
from __future__ import annotations

import math
from typing import Iterable

BUCKETS = 96  # 15-minute buckets; bucket b covers [15b, 15b + 15) minutes after midnight
DOWS = (1, 2, 3, 4, 5)  # ISO weekday: Mon..Fri
DAY_OF = {"M": 1, "T": 2, "W": 3, "R": 4, "F": 5}

# Mirrors MODEL in src/lib/demand.ts.
MODEL = {
    "radius_m": 900,
    "lead_min": 15,
    "lag_min": 15,
    "smooth_buckets": 2,
    "floor_frac": 0.04,
    "peak_frac": 0.95,
    "class_weight": {"cg": 0.9, "fs": 0.25, "fsv": 0.35, "other": 0.5},
    "friday_staff_scale": 0.85,
}


def js_round(x: float) -> int:
    """JavaScript Math.round for non-negative numbers (round half up); Python's round() is banker's rounding."""
    return int(math.floor(x + 0.5))


def level_kind(classes: Iterable[str]) -> str:
    classes = list(classes)
    if all(c == "perry-cg" for c in classes):
        return "cg"
    if all(c == "perry-fs" for c in classes):
        return "fs"
    if all(c == "fsv" for c in classes):
        return "fsv"
    return "other"


def haversine_m(a: dict, b: dict) -> float:
    r = 6371000
    rad = math.radians
    d_lat = rad(b["lat"] - a["lat"])
    d_lon = rad(b["lon"] - a["lon"])
    h = math.sin(d_lat / 2) ** 2 + math.cos(rad(a["lat"])) * math.cos(rad(b["lat"])) * math.sin(d_lon / 2) ** 2
    return 2 * r * math.asin(math.sqrt(h))


def pull(distance_m: float, model: dict = MODEL) -> float:
    """0..1 pull of a building on a garage: 1 next door, 0 at/after radius, squared falloff."""
    if distance_m >= model["radius_m"]:
        return 0.0
    return (1 - distance_m / model["radius_m"]) ** 2


def staff_shape(minute: float) -> float:
    """A typical staff workday: ramps up 6:30-9:00, plateau, drains 15:30-18:30."""
    h = minute / 60

    def smoothstep(x: float) -> float:
        return x * x * (3 - 2 * x)

    def clamp01(x: float) -> float:
        return min(1.0, max(0.0, x))

    up = smoothstep(clamp01((h - 6.5) / 2.5))
    down = smoothstep(clamp01((h - 15.5) / 3))
    return up * (1 - 0.85 * down)


def percentile(values: list[float], q: float) -> float:
    """Nearest-rank percentile (q in 0..1); 0 for an empty list."""
    if not values:
        return 0.0
    s = sorted(values)
    return s[min(len(s) - 1, max(0, math.ceil(q * len(s)) - 1))]


def smooth(values: list[float], radius: int) -> list[float]:
    """Centered moving average over +/- radius buckets (window shrinks at the edges of the day)."""
    out = []
    for i in range(len(values)):
        lo = max(0, i - radius)
        hi = min(len(values) - 1, i + radius)
        total = 0.0
        for j in range(lo, hi + 1):
            total += values[j]
        out.append(total / (hi - lo + 1))
    return out


def place(meetings: list[dict], codes: dict, points: dict) -> list[dict]:
    """Attach a lat/lon to every meeting group whose building code maps to a known GIS building (others are dropped)."""
    placed = []
    for group in meetings:
        code = codes.get(group["building"])
        point = points.get(code["num"]) if code else None
        if point:
            placed.append({"group": group, "lat": point["lat"], "lon": point["lon"]})
    return placed


def coverage(meetings: list[dict], codes: dict, points: dict) -> tuple[int, int]:
    """(placed seat-meetings, total seat-meetings): capacity x meeting days, counted once per weekly slot."""
    placed_seats = total_seats = 0
    for g in meetings:
        seats = g["capacity"] * len(g["days"])
        total_seats += seats
        code = codes.get(g["building"])
        if code and code["num"] in points:
            placed_seats += seats
    return placed_seats, total_seats


def raw_activity(placed: list[dict], garage: dict, model: dict = MODEL) -> dict[int, list[float]]:
    """Seat-weighted activity per weekday x bucket; a meeting is active from start - lead to end + lag."""
    out = {d: [0.0] * BUCKETS for d in DOWS}
    for p in placed:
        w = pull(haversine_m(p, garage), model)
        if w == 0:
            continue
        g = p["group"]
        seats = g["capacity"] * w
        first = max(0, math.floor((g["startMin"] - model["lead_min"]) / 15))
        last = min(BUCKETS - 1, math.floor((g["endMin"] + model["lag_min"] - 1) / 15))
        for day in g["days"]:
            arr = out[DAY_OF[day]]
            for b in range(first, last + 1):
                arr[b] += seats
    return out


def build_level_curves(placed: list[dict], garages: list[dict], model: dict = MODEL) -> list[dict]:
    """Per-level target percent-full for Mon..Fri; same-kind levels fill bottom-up. Deterministic (no randomness)."""
    curves = []
    for g in garages:
        rough = raw_activity(placed, g, model)
        raw = {d: smooth(rough[d], model["smooth_buckets"]) for d in DOWS}
        nonzero = [v for d in DOWS for v in raw[d] if v > 0]
        peak = max(1.0, percentile(nonzero, 0.95))
        groups: dict[str, list[int]] = {}
        for i, lv in enumerate(g["levels"]):
            groups.setdefault(level_kind(lv["classes"]), []).append(i)
        for d in DOWS:
            staff_scale = model["friday_staff_scale"] if d == 5 else 1
            per_level: dict[int, list[int]] = {}
            for kind, idxs in groups.items():
                cw = model["class_weight"][kind]
                total_cap = sum(g["levels"][i]["capacity"] for i in idxs)
                occ = [[0.0] * BUCKETS for _ in idxs]
                for b in range(BUCKETS):
                    activity = min(1.0, raw[d][b] / peak)
                    staff = staff_shape(b * 15 + 7) * staff_scale
                    frac = model["floor_frac"] + (model["peak_frac"] - model["floor_frac"]) * (cw * activity + (1 - cw) * staff)
                    remaining = min(1.0, frac) * total_cap
                    for k, lvl in enumerate(idxs):
                        take = min(g["levels"][lvl]["capacity"], remaining)
                        occ[k][b] = take
                        remaining -= take
                for k, lvl in enumerate(idxs):
                    cap = g["levels"][lvl]["capacity"]
                    per_level[lvl] = [js_round((100 * o) / cap) for o in occ[k]]
            for level_index in sorted(per_level):
                curves.append({"garage_id": g["id"], "level_index": level_index, "dow": d, "pct": per_level[level_index]})
    return curves


def render_rows(curves: list[dict]) -> str:
    """The value rows of supabase/curves.seed.sql, identical to renderCurvesSql in src/lib/curves-sql.ts."""
    q = lambda s: "'" + s.replace("'", "''") + "'"  # noqa: E731
    rows = [f"  ({q(c['garage_id'])}, {c['level_index']}, {c['dow']}, '{{{','.join(str(v) for v in c['pct'])}}}')" for c in curves]
    return ",\n".join(rows)


def render_seed_sql(curves: list[dict], source: str = "the Databricks notebook 03_gold_curves") -> str:
    return (
        f"-- GENERATED by {source}. Do not edit by hand.\n"
        "-- SIMULATED targets shaped by VT's class timetable (seat capacity, not enrollment) - not sensor data.\n"
        "insert into public.garage_level_curves (garage_id, level_index, dow, pct)\n"
        "values\n"
        f"{render_rows(curves)}\n"
        "on conflict (garage_id, level_index, dow) do update set pct = excluded.pct;\n"
    )


def summarize(curves: list[dict], garages: list[dict], dow: int = 3) -> list[dict]:
    """Per-garage headline numbers for one weekday, used as MLflow metrics: peak fill, hour of peak, hours at >=90%."""
    out = []
    for g in garages:
        cap = sum(lv["capacity"] for lv in g["levels"])
        total = [0.0] * BUCKETS
        for c in curves:
            if c["garage_id"] == g["id"] and c["dow"] == dow:
                for b, v in enumerate(c["pct"]):
                    total[b] += v * g["levels"][c["level_index"]]["capacity"] / 100
        pct = [100 * t / cap for t in total]
        peak = max(pct)
        out.append(
            {
                "garage_id": g["id"],
                "peak_fill_pct": round(peak, 1),
                "peak_hour": pct.index(peak) / 4,
                "hours_at_or_above_90": sum(1 for v in pct if v >= 90) / 4,
                "max_15min_change": round(max(abs(pct[i] - pct[i - 1]) for i in range(1, BUCKETS)), 1),
            }
        )
    return out


def mean_abs_diff(a: list[dict], b: list[dict]) -> float:
    """Mean absolute difference, in percentage points, between two sets of curves with the same keys (sensitivity vs a baseline)."""
    key = lambda c: (c["garage_id"], c["level_index"], c["dow"])  # noqa: E731
    bmap = {key(c): c["pct"] for c in b}
    total = n = 0
    for c in a:
        for x, y in zip(c["pct"], bmap[key(c)]):
            total += abs(x - y)
            n += 1
    return total / n if n else 0.0


def level_hours_at_or_above(curves: list[dict], garage_id: str, level_index: int, dow: int = 3, threshold: int = 90) -> float:
    """Hours of the day one level is at or above `threshold` percent full (e.g. the commuter level on a Wednesday)."""
    for c in curves:
        if (c["garage_id"], c["level_index"], c["dow"]) == (garage_id, level_index, dow):
            return sum(1 for v in c["pct"] if v >= threshold) / 4
    raise KeyError((garage_id, level_index, dow))
