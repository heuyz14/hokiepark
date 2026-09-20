"""Tests for the Monte Carlo simulator. Run from the repo root: python3 databricks/tests/test_sim.py (or npm run test:py)."""
import json
import pathlib
import random
import statistics
import sys
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "databricks" / "src"))
import hokiepark_demand as hd  # noqa: E402
import hokiepark_sim as hs  # noqa: E402

load = lambda p: json.loads((ROOT / p).read_text())  # noqa: E731


class Sim(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        tt, codes, pts = load("data/raw/timetable.json"), load("data/reference/timetable-building-codes.json"), load("databricks/data/building_points.json")
        cls.units = load("databricks/data/units.json")
        cls.garages = load("databricks/data/garages.json")
        cls.placed = hd.place(tt["meetings"], codes, pts)
        cls.ctx = hs.build_context(cls.placed, cls.units)

    def test_units_cover_every_garage_level_and_lot(self):
        self.assertEqual(sum(1 for u in self.units if u["kind"] == "garage-level"), sum(len(g["levels"]) for g in self.garages))
        self.assertEqual(len({u["id"] for u in self.units}), len(self.units), "unit ids must be unique")

    def test_deterministic_mode_reproduces_the_apps_garage_curves(self):
        curves = hd.build_level_curves(self.placed, self.garages)
        for d in hd.DOWS:
            mc = hs.mean_curve(self.ctx, d)
            for c in (c for c in curves if c["dow"] == d):
                got = mc[f"{c['garage_id']}:{c['level_index']}"]
                # the app rounds to whole percents; the simulator keeps decimals
                self.assertTrue(all(abs(a - b) <= 0.5 + 1e-9 for a, b in zip(got, c["pct"])), (c["garage_id"], c["level_index"], d))

    def test_same_seed_same_data_different_seed_different_data(self):
        a = hs.simulate_training_set(self.ctx, days_per_dow=1, seed=1)
        b = hs.simulate_training_set(self.ctx, days_per_dow=1, seed=1)
        c = hs.simulate_training_set(self.ctx, days_per_dow=1, seed=2)
        self.assertEqual(a["pct"], b["pct"])
        self.assertNotEqual(a["pct"], c["pct"])

    def test_labels_are_percentages_and_shapes_line_up(self):
        ts = hs.simulate_training_set(self.ctx, days_per_dow=1, seed=3)
        n = len(ts["pct"])
        self.assertEqual(n, 5 * len(self.units) * hd.BUCKETS)
        for k in ("day_id", "dow", "unit_id", "bucket"):
            self.assertEqual(len(ts[k]), n)
        self.assertTrue(all(0.0 <= v <= 100.0 for v in ts["pct"]))
        self.assertEqual(len(ts["_day_params"]), 5)

    def test_randomised_days_actually_differ_and_stay_close_to_the_mean_day(self):
        rng = random.Random(5)
        days = [hs.simulate_day(self.ctx, 3, hs.draw_params(rng), rng) for _ in range(6)]
        uid = "perry-street:0"
        self.assertGreater(len({round(sum(d[uid]), 3) for d in days}), 1, "days should not be identical")
        mean_day = hs.mean_curve(self.ctx, 3)[uid]
        avg = [statistics.mean(d[uid][b] for d in days) for b in range(hd.BUCKETS)]
        self.assertLess(statistics.mean(abs(a - m) for a, m in zip(avg, mean_day)), 8.0)

    def test_draw_params_respect_their_bounds(self):
        rng = random.Random(9)
        for _ in range(200):
            p = hs.draw_params(rng)
            for k, (_, _, lo, hi) in hs.DISTRIBUTIONS.items():
                if k in ("lead_min", "lag_min"):
                    continue
                self.assertTrue(lo <= p[k] <= hi, (k, p[k]))

    def test_more_class_demand_raises_the_commuter_level(self):
        low = dict(hs.deterministic_params(), class_scale=0.6)
        high = dict(hs.deterministic_params(), class_scale=1.4)
        uid = "perry-street:0"  # the class-driven (commuter) level
        self.assertLess(sum(hs.simulate_day(self.ctx, 3, low)[uid]), sum(hs.simulate_day(self.ctx, 3, high)[uid]))

    def test_lots_are_differentiated_not_all_identical(self):
        mc = hs.mean_curve(self.ctx, 3)
        peaks = [max(v) for k, v in mc.items() if ":" not in k]
        self.assertGreater(max(peaks) - min(peaks), 20)

    def test_feature_table_one_row_per_unit_dow_bucket_with_no_missing_values(self):
        ft = hs.feature_table(self.ctx)
        self.assertEqual(len(ft["unit_id"]), len(self.units) * 5 * hd.BUCKETS)
        for col in hs.FEATURE_COLUMNS:
            self.assertEqual(len(ft[col]), len(ft["unit_id"]), col)
            self.assertTrue(all(v is not None and v == v for v in ft[col]), col)

    def test_class_features_move_with_the_schedule(self):
        ft = hs.feature_table(self.ctx)
        # somewhere in the week there is upcoming, ended and in-session demand for at least one place
        for col in ("upcoming_30", "ended_30", "insession"):
            self.assertGreater(max(ft[col]), 0, col)
        # nothing is in session at 3 am
        self.assertTrue(all(v == 0 for v, m in zip(ft["insession"], ft["minute"]) if m == 180))


if __name__ == "__main__":
    unittest.main(verbosity=2)
