"""Tests for the training/evaluation helpers. Needs pandas + scikit-learn; skipped when they are not installed.
Run: python3 databricks/tests/test_ml.py"""
import json
import pathlib
import sys
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "databricks" / "src"))

try:
    import numpy as np
    import pandas as pd
    import hokiepark_ml as ml
    HAVE = True
except ImportError:
    HAVE = False

import hokiepark_demand as hd  # noqa: E402
import hokiepark_sim as hs  # noqa: E402

load = lambda p: json.loads((ROOT / p).read_text())  # noqa: E731


@unittest.skipUnless(HAVE, "pandas / scikit-learn not installed")
class ML(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        tt, codes, pts = load("data/raw/timetable.json"), load("data/timetable-building-codes.json"), load("databricks/data/building_points.json")
        cls.units = load("databricks/data/units.json")
        ctx = hs.build_context(hd.place(tt["meetings"], codes, pts), cls.units)
        ts = hs.simulate_training_set(ctx, days_per_dow=4, seed=11)
        ts.pop("_day_params")
        cls.df = ml.join_labels(pd.DataFrame(ts), pd.DataFrame(hs.feature_table(ctx)))

    def test_join_keeps_every_label_row_and_rejects_orphans(self):
        self.assertEqual(len(self.df), 5 * 4 * len(self.units) * 96)
        orphan = pd.DataFrame({"unit_id": ["nope"], "dow": [1], "bucket": [0], "pct": [1.0], "day_id": [0]})
        with self.assertRaises(ValueError):
            ml.join_labels(orphan, pd.DataFrame(hs.feature_table(hs.build_context([], self.units))))

    def test_day_split_holds_out_whole_days_in_every_weekday(self):
        mask = ml.split_days(self.df)
        test_days, train_days = set(self.df[mask].day_id), set(self.df[~mask].day_id)
        self.assertFalse(test_days & train_days, "a day must not appear in both sets")
        self.assertEqual({d for d in self.df[mask].dow.unique()}, {1, 2, 3, 4, 5})

    def test_place_split_hides_only_lots_and_is_reproducible(self):
        hidden = ml.split_places(self.units)
        self.assertTrue(hidden and all(not u["id"].count(":") for u in self.units if u["id"] in hidden), "only lots are hidden")
        self.assertEqual(hidden, ml.split_places(self.units))

    def test_model_input_has_fixed_dtypes_and_columns(self):
        X = ml.to_frame(self.df.head(5))
        self.assertEqual(list(X.columns), ml.FEATURES)
        self.assertTrue(all(str(X[c].dtype) == "int64" for c in ml.INT_FEATURES))
        self.assertTrue(all(str(X[c].dtype) == "float64" for c in ml.FEATURES if c not in ml.INT_FEATURES))

    def test_metrics_are_correct_on_a_known_case(self):
        m = ml.metrics(np.array([0.0, 10.0, 20.0]), np.array([1.0, 10.0, 17.0]), np.array([600, 600, 0]))
        self.assertAlmostEqual(m["mae"], 4 / 3)
        self.assertAlmostEqual(m["mae_busy_hours"], 0.5)

    def test_evaluate_reports_the_expected_structure_and_class_features_help_on_new_places(self):
        res = ml.evaluate(self.df, self.units)
        for split in ("held_out_days", "held_out_places"):
            for name in ("forecaster_full_features", "forecaster_without_class_features"):
                self.assertIn("mae", res[split][name])
        self.assertIn("place_agnostic_average", res["held_out_places"])
        self.assertIn("lookup_mean_of_training_days", res["held_out_days"])
        p = res["held_out_places"]
        # the model must beat the no-information baseline on places it never saw
        self.assertLess(p["forecaster_full_features"]["mae"], p["place_agnostic_average"]["mae"])
        self.assertEqual(len(res["permutation_importance_mae_increase"]), len(ml.FEATURES))

    def test_final_model_predicts_in_range_shape(self):
        model = ml.fit_final(self.df.sample(n=20000, random_state=0))
        pred = model.predict(ml.to_frame(self.df.head(100)))
        self.assertEqual(pred.shape, (100,))


if __name__ == "__main__":
    unittest.main(verbosity=2)
