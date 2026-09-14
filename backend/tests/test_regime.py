"""Tests for item 10 wiring: binary-segmentation change points and event
categories in backend/core/data/build_regimes.py (via anomalies.py)."""
from __future__ import annotations

import numpy as np
import pandas as pd

from backend.core.data.anomalies import (
    binary_segmentation_changepoints,
    event_classify,
)


def test_binseg_detects_level_shift():
    rng = np.random.default_rng(0)
    series = pd.Series(np.concatenate([
        rng.normal(6, 1, 100), rng.normal(30, 1, 100),
    ]))
    cps = binary_segmentation_changepoints(series)
    assert len(cps) >= 1
    assert any(abs(cp - 100) <= 15 for cp in cps), f"step at 100 not found: {cps}"
    assert all(0 <= cp < len(series) for cp in cps)


def test_binseg_constant_series_empty():
    cps = binary_segmentation_changepoints(pd.Series([5.0] * 200))
    assert cps == []


def test_event_classify_branches():
    df = pd.DataFrame([
        {"regime_disrupted": 0, "delay_hours": 5.0, "congestion_index": 0.1,
         "conflict_risk_score": 0.0, "weather_severity": 0.1, "node_id": "busan"},
        {"regime_disrupted": 1, "delay_hours": 30.0, "congestion_index": 0.1,
         "conflict_risk_score": 0.9, "weather_severity": 0.1, "node_id": "suez"},
        {"regime_disrupted": 1, "delay_hours": 30.0, "congestion_index": 0.9,
         "conflict_risk_score": 0.0, "weather_severity": 0.1, "node_id": "busan"},
        {"regime_disrupted": 1, "delay_hours": 30.0, "congestion_index": 0.1,
         "conflict_risk_score": 0.0, "weather_severity": 0.9, "node_id": "busan"},
        {"regime_disrupted": 1, "delay_hours": 30.0, "congestion_index": 0.1,
         "conflict_risk_score": 0.0, "weather_severity": 0.1, "node_id": "busan"},
    ])
    labels = event_classify(df).tolist()
    assert labels == ["normal", "geopolitical", "congestion", "weather", "disruption"]


def _small_gold() -> pd.DataFrame:
    rng = np.random.default_rng(3)
    rows = []
    for nid in ("busan", "suez"):
        for d in range(60):
            rows.append({
                "node_id": nid,
                "timestamp": pd.Timestamp("2024-01-01") + pd.Timedelta(days=d),
                "delay_hours": float(30 if (nid == "suez" and d >= 40) else 6)
                + float(rng.normal(0, 1)),
                "congestion_index": 0.2, "weather_severity": 0.2,
                "conflict_risk_score": 0.8 if nid == "suez" else 0.0,
            })
    return pd.DataFrame(rows)


def test_build_emits_wired_columns(tmp_path):
    from backend.core.data.build_regimes import build
    out = build(_small_gold(), out_path=tmp_path / "regimes.parquet")
    assert {"change_point_source", "event_category"} <= set(out.columns)
    assert set(out["change_point_source"].unique()) <= {"none", "transition", "binseg", "both"}
    assert set(out["event_category"].unique()) <= {
        "normal", "disruption", "congestion", "weather", "geopolitical", "major_disruption"}
    # flag must equal union of the two detectors
    trans = out["change_point_source"].isin(["transition", "both"])
    assert (out["change_point_flag"] == (trans | out["change_point_source"].isin(["binseg", "both"]))).all()


def test_committed_regimes_has_wired_columns():
    from backend.core.config import get_settings
    rg = pd.read_parquet(
        get_settings().abs_data_dir / "features" / "regimes.parquet")
    assert {"change_point_source", "event_category"} <= set(rg.columns)
    assert (rg["change_point_flag"] ==
            rg["change_point_source"].isin(["transition", "binseg", "both"])).all()
