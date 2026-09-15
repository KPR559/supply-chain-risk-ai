"""Build checkpoint_features + ml_training_data (Sections 23-24 — Features 11-14).

Joins (per node x date):
  gold/node_observations       — delay_hours + congestion/weather/conflict/customs (53K)
  features/port_activity       — activity, pressure, risk (50K, 18 nodes)
  features/weather_features    — wind/precip sums, anomaly (53K, 19 nodes)
  features/disruption_features — event_presence/severity per node-day (2,479, 6 nodes)
  features/regimes             — regime_state, change_point, anomalies (53K, 19 nodes)
  features/temporal            — is_holiday, season, days_to_holiday (22K, 8 countries)
  silver/checkpoints + silver/route_edges — graph context (19 nodes, 27 edges)

Outputs:
  data/features/checkpoint_features.parquet  — Section 23 (53K rows, ~80 cols, train-ready)
  data/ml/ml_training_data.parquet           — Section 24 (same, with delay_flag + splits)
  data/ml/train.parquet, validation.parquet, test.parquet
  Feature groups are leakage-free: all rolling stats use shift(1) (past_only=True).

Usage:
  python -m backend.core.data.build_features
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from backend.core import storage
from backend.core.config import get_settings
from backend.core.data.anomalies import detect_regime
from backend.core.features.node_features import build_features
from backend.core.logging_util import get_logger

log = get_logger(__name__)

PORT_NODES = {"shanghai","singapore","busan","rotterdam","los_angeles","new_york","dubai","mumbai","colombo"}
COUNTRY_MAP = {"shanghai":"CN","singapore":"SG","busan":"KR","rotterdam":"NL","los_angeles":"US","new_york":"US","dubai":"AE","mumbai":"IN","colombo":"LK"}


def build() -> tuple[pd.DataFrame, pd.DataFrame]:
    s = get_settings()
    # -- load base --
    gold = pd.read_parquet(s.abs_data_dir / "gold" / "node_observations" / "observations.parquet")
    gold["timestamp"] = pd.to_datetime(gold["timestamp"]).dt.tz_localize(None)
    gold["date"] = gold["timestamp"].dt.normalize()
    log.info(f"gold: {len(gold)} rows")

    # -- load feature layers --
    port = pd.read_parquet(s.abs_data_dir / "features" / "port_activity" / "port_features.parquet")
    port["date"] = pd.to_datetime(port["date"]).dt.normalize()
    weather = pd.read_parquet(s.abs_data_dir / "features" / "weather_features" / "weather_features.parquet")
    weather["date"] = pd.to_datetime(weather["date"]).dt.normalize()
    regimes = pd.read_parquet(s.abs_data_dir / "features" / "regimes.parquet")
    regimes["date"] = pd.to_datetime(regimes["timestamp"]).dt.normalize()
    # temporal: map via country for port nodes, fallback for others
    temporal = pd.read_parquet(s.abs_data_dir / "features" / "temporal" / "temporal_features.parquet")
    temporal["date"] = pd.to_datetime(temporal["date"]).dt.normalize()

    # disruption features (sparse: 6 nodes only)
    disp_path = s.abs_data_dir / "features" / "disruption_features" / "disruption_features.parquet"
    disp = pd.read_parquet(disp_path) if disp_path.exists() else pd.DataFrame()
    if not disp.empty:
        disp["date"] = pd.to_datetime(disp["date"]).dt.normalize()

    # checkpoints geo (for lat/lon/distance features)
    ckpt = pd.read_parquet(s.abs_data_dir / "silver" / "checkpoints.parquet")
    edges = pd.read_parquet(s.abs_data_dir / "silver" / "route_edges.parquet")

    # -- regime enrichment: ensure gold has regime columns via detect_regime (adds regime_disrupted etc.) --
    gold_enriched = detect_regime(gold[["node_id","timestamp","delay_hours","congestion_index","weather_severity","conflict_risk_score"]].copy())
    for col in ("regime_disrupted","regime_roll_z","regime_cusum","regime_iso"):
        if col in gold_enriched.columns:
            gold[col] = gold_enriched[col].values

    # -- join: start from gold (53K), left-join sparse layers --
    df = gold.copy()

    # Port features
    port_cols = ["activity_7d_avg","activity_30d_avg","activity_zscore","port_pressure_index","operational_risk_score"]
    df = df.merge(port[[c for c in ["node_id","date"]+port_cols if c in port.columns]],
                  on=["node_id","date"], how="left")

    # Weather features
    w_cols = ["wind_speed_7d_avg","precipitation_7d_sum","precipitation_30d_sum","temperature_7d_avg","weather_anomaly","weather_anomaly_score","extreme_weather_flag"]
    df = df.merge(weather[[c for c in ["node_id","date"]+w_cols if c in weather.columns]],
                  on=["node_id","date"], how="left")

    # Regimes
    reg_cols = ["regime_state","change_point_flag","change_point_score","regime_duration_days","delay_anomaly","congestion_anomaly","weather_anomaly","regime_confidence"]
    # regimes has node_id+date already
    reg_sub = regimes[["node_id","date"] + [c for c in reg_cols if c in regimes.columns]].drop_duplicates()
    df = df.merge(reg_sub, on=["node_id","date"], how="left")

    # Disruptions (sparse)
    if not disp.empty:
        d_cols = ["event_presence","event_severity","disruption_flag","major_disruption_flag","geopolitical_risk","event_exposure_score"]
        df = df.merge(disp[["node_id","date"] + [c for c in d_cols if c in disp.columns]],
                      on=["node_id","date"], how="left")
        for c in d_cols:
            if c in df.columns:
                df[c] = df[c].fillna(0)

    # Temporal (per country for port nodes, global mean for others)
    # Build date→temporal lookup per country
    for _, r in df.iterrows():
        pass  # vectorized below

    # Fast vectorized temporal join: map each row's country to temporal
    df["country"] = df["node_id"].map(COUNTRY_MAP).fillna("")
    # For port nodes, join on (country, date)
    port_mask = df["node_id"].isin(PORT_NODES)
    if port_mask.any():
        tmp_sub = temporal[["country","date","days_to_holiday","days_since_holiday","holiday_period_flag","season","is_weekend"]]
        # Merge only port rows
        merged = df.loc[port_mask, ["country","date"]].merge(tmp_sub, on=["country","date"], how="left")
        for c in ["days_to_holiday","days_since_holiday","holiday_period_flag","season","is_weekend"]:
            df.loc[port_mask, c] = merged[c].values
    # For non-port nodes, fill defaults
    for c in ["days_to_holiday","days_since_holiday","holiday_period_flag"]:
        df[c] = df[c].fillna(365 if "days_" in c else 0)
    df["is_weekend"] = df.get("is_weekend", 0)
    df["season"] = df["season"].fillna("unknown") if "season" in df.columns else "unknown"

    # Graph features (from checkpoints/edges)
    # distance_to_next / remaining via edge topology would need route context;
    # for node-level ML we keep simple geo: lat/lon and a betweenness proxy
    ckpt_map = ckpt.set_index("node_id")[["latitude","longitude"]].to_dict("index")
    df["latitude"] = df["node_id"].map(lambda n: ckpt_map.get(n, {}).get("latitude", 0))
    df["longitude"] = df["node_id"].map(lambda n: ckpt_map.get(n, {}).get("longitude", 0))
    # Transport mode: port/sea/canal/strait
    kind_map = {n["id"]: n["kind"] for n in [
        {"id": n, "kind": ckpt.loc[ckpt["node_id"]==n, "node_type"].iloc[0] if (ckpt["node_id"]==n).any() else "port"}
        for n in df["node_id"].unique()
    ]}
    # Simpler: from ckpt node_type
    ckpt_kind = ckpt.set_index("node_id")["node_type"].to_dict()
    df["checkpoint_type"] = df["node_id"].map(ckpt_kind).fillna("port")
    df["transport_mode"] = df["checkpoint_type"].map({"port":"sea","canal":"sea","strait":"sea","sea":"sea"}).fillna("sea")

    # Node degree (from route_edges)
    out_deg = edges.groupby("source_node_id").size().to_dict()
    in_deg = edges.groupby("target_node_id").size().to_dict()
    df["out_degree"] = df["node_id"].map(out_deg).fillna(0).astype(int)
    df["in_degree"] = df["node_id"].map(in_deg).fillna(0).astype(int)

    # Historical delay aggregates (leakage-free: computed via node_features, not here; kept as placeholders)
    # node_features.historical_delay_features will compute rolling stats on the sorted gold itself.
    # We just ensure the raw predictors needed by that module are present.

    # -- leakage-free feature engineering via node_features (time + historical + congestion/weather/customs/conflict/regime) --
    # build_features expects: node_id, timestamp, delay_hours, congestion_index, weather_severity, conflict_risk_score, customs_workload, is_holiday, plus regime_*
    feat_input = df.copy()
    # Fill NaNs for feature engineering
    for c in ["congestion_index","weather_severity","conflict_risk_score","customs_workload"]:
        feat_input[c] = pd.to_numeric(feat_input[c], errors="coerce").fillna(0)
    feat_input["is_holiday"] = pd.to_numeric(feat_input.get("is_holiday", 0), errors="coerce").fillna(0).astype(int)

    engineered = build_features(feat_input)

    # Combine: keep original predictors + engineered + graph/temporal/disruption extras that engineered doesn't produce
    extra_cols = [c for c in ["activity_7d_avg","activity_30d_avg","activity_zscore","port_pressure_index","operational_risk_score",
                               "wind_speed_7d_avg","precipitation_7d_sum","weather_anomaly_score","extreme_weather_flag",
                               "regime_state","change_point_flag","regime_duration_days","delay_anomaly","congestion_anomaly",
                               "event_presence","event_severity","disruption_flag","major_disruption_flag","geopolitical_risk",
                               "days_to_holiday","days_since_holiday","holiday_period_flag","season",
                               "latitude","longitude","checkpoint_type","transport_mode","out_degree","in_degree"]
                  if c in df.columns]

    checkpoint_features = pd.concat([
        df[["node_id","timestamp","delay_hours","congestion_index","weather_severity","conflict_risk_score","customs_workload","is_holiday","baseline_90d","annual_delay_mean","cppi_score","label_source"]].reset_index(drop=True),
        engineered.reset_index(drop=True),
        df[extra_cols].reset_index(drop=True) if extra_cols else pd.DataFrame(),
    ], axis=1)
    # Deduplicate cols (engineered may duplicate some)
    checkpoint_features = checkpoint_features.loc[:, ~checkpoint_features.columns.duplicated()].copy()

    # Targets
    thr = get_settings().delay_threshold_hours
    checkpoint_features["delay_flag"] = (checkpoint_features["delay_hours"] > thr).astype(int)

    # Chronological train/val/test (70/15/15) — Section 42 rule: must be chronological
    checkpoint_features = checkpoint_features.sort_values(["timestamp","node_id"]).reset_index(drop=True)
    n = len(checkpoint_features)
    n_train = int(n * 0.70)
    n_val = int(n * 0.15)
    checkpoint_features["split"] = "test"
    checkpoint_features.loc[:n_train-1, "split"] = "train"
    checkpoint_features.loc[n_train:n_train+n_val-1, "split"] = "val"

    # -- write --
    feat_path = s.abs_data_dir / "features" / "checkpoint_features.parquet"
    feat_path.parent.mkdir(parents=True, exist_ok=True)
    checkpoint_features.to_parquet(feat_path, index=False)
    log.info(f"Wrote checkpoint_features: {len(checkpoint_features)} rows, {len(checkpoint_features.columns)} cols -> {feat_path}")

    ml_dir = s.abs_data_dir / "ml"
    ml_dir.mkdir(parents=True, exist_ok=True)
    ml_path = ml_dir / "ml_training_data.parquet"
    checkpoint_features.to_parquet(ml_path, index=False)
    log.info(f"Wrote ml_training_data -> {ml_path}")

    for split in ("train","val","test"):
        sub = checkpoint_features[checkpoint_features["split"]==split].copy()
        p = ml_dir / f"{split}.parquet"
        sub.to_parquet(p, index=False)
        log.info(f"  {split}: {len(sub)} rows -> {p}")

    return checkpoint_features, checkpoint_features


def main() -> None:
    df, _ = build()
    print(f"checkpoint_features: {len(df)} rows, {len(df.columns)} cols")
    print(f"  splits: {df['split'].value_counts().to_dict()}")
    print(f"  delay_flag rate: {df['delay_flag'].mean():.3f}")
    print(f"  nodes: {df['node_id'].nunique()}")
    # Feature group preview
    print(f"  sample cols: {list(df.columns)[:18]}")


if __name__ == "__main__":
    main()
