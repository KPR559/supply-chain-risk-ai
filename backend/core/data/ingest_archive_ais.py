"""Ingest the local Kaggle LA/LB AIS archive (real observed delays).

Source: archive/ais_*.parquet (Kaggle: nguyenductuandat/lalb-ais-port-congestion-62023-122025)
  6 half-year files + 1 consolidated clean file
  visit_id + mmsi = unique port visit (6562 visits, 4749 with delay_minutes)

Outputs:
  data/silver/ais_visits.parquet          — one row per real port visit (the label)
  data/raw/ais_daily.parquet              — daily vessel activity per port
  Adds los_angeles rows to silver/checkpoint_outcomes.parquet (real per-visit)

Usage:
  python -m backend.core.data.ingest_archive_ais
"""
from __future__ import annotations

import duckdb
import pandas as pd

from backend.core import storage
from backend.core.config import get_settings
from backend.core.logging_util import get_logger

log = get_logger(__name__)

ARCHIVE = "D:/TECHNOVA 2026/supply-chain-risk-ai/archive"
NODE = "los_angeles"


def _con():
    return duckdb.connect()


def build_visits() -> pd.DataFrame:
    """One row per real port visit (visit_id, mmsi)."""
    con = _con()
    try:
        # Use half-year files to get proper per-visit delay (clean has dedup issues with visit_id=1 covering thousands)
        dfs = []
        for f in ["ais_2023H2.parquet", "ais_2024H1.parquet", "ais_2024H2.parquet", "ais_2025H1.parquet", "ais_2025H2.parquet"]:
            p = f"{ARCHIVE}/{f}"
            try:
                df = con.execute(f"""
                    SELECT
                        visit_id, mmsi,
                        any_value(vessel_name) as vessel_name,
                        any_value(vessel_type) as vessel_type,
                        any_value(delay_minutes) as delay_minutes,
                        any_value(length) as length_m,
                        any_value(width) as width_m,
                        min(hour_key) as arrival_time,
                        max(hour_key) as departure_time,
                        count(*) as ping_count
                    FROM read_parquet('{p}')
                    GROUP BY visit_id, mmsi
                """).fetchdf()
                dfs.append(df)
            except Exception as e:
                log.warning(f"{f}: {e}")
        all_visits = pd.concat(dfs, ignore_index=True)
        # Deduplicate (visit_id resets per half, but mmsi+arrival is unique)
        all_visits = all_visits.drop_duplicates(subset=["mmsi", "arrival_time"]).reset_index(drop=True)

        # Enrich
        all_visits["node_id"] = NODE
        all_visits["checkpoint_id"] = NODE
        all_visits["delay_hours"] = all_visits["delay_minutes"] / 60.0
        all_visits["delay_flag"] = (all_visits["delay_hours"] > 24).astype("Int64")
        all_visits["observation_id"] = all_visits.apply(
            lambda r: f"ais-{r['mmsi']}-{pd.to_datetime(r['arrival_time']).strftime('%Y%m%d%H%M')}", axis=1
        )
        all_visits["data_timestamp"] = pd.to_datetime(all_visits["arrival_time"]).dt.tz_localize(None)
        all_visits["source"] = "Kaggle LA/LB AIS archive (NOAA MarineCadastre via NGD)"
        all_visits["label_source"] = "observed (AIS: waiting->moored transition)"
        return all_visits
    finally:
        con.close()


def build_daily() -> pd.DataFrame:
    """Daily vessel activity at LA/LB (for feature engineering)."""
    con = _con()
    try:
        path_clean = f"{ARCHIVE}/ais_2023_2025_clean.parquet"
        df = con.execute(f"""
            SELECT
                date_trunc('day', hour_key)::DATE as date,
                count(DISTINCT mmsi) as vessel_count,
                count(DISTINCT CASE WHEN sog < 0.5 THEN mmsi END) as anchored_count,
                avg(sog) as avg_sog,
                avg(ship_density) as avg_ship_density,
                avg(port_throughput) as avg_throughput,
                avg(avg_port_speed) as avg_port_speed,
                count(*) as ping_count
            FROM read_parquet('{path_clean}')
            GROUP BY 1 ORDER BY 1
        """).fetchdf()
        df["node_id"] = NODE
        return df
    finally:
        con.close()


def main() -> None:
    s = get_settings()
    storage.ensure_storage_dirs()

    visits = build_visits()
    silver_dir = s.abs_data_dir / "silver"
    silver_dir.mkdir(parents=True, exist_ok=True)
    out = silver_dir / "ais_visits.parquet"
    visits.to_parquet(out, index=False)
    log.info(f"Wrote {len(visits)} visits -> {out}")
    valid = visits.dropna(subset=["delay_minutes"])
    print(f"visits: {len(visits)} total, {len(valid)} with delay")
    print(f"  delay_hours: mean={valid['delay_hours'].mean():.1f} median={valid['delay_hours'].median():.1f} p90={valid['delay_hours'].quantile(0.9):.1f}")
    print(f"  delayed>24h: {(valid['delay_hours'] > 24).sum()} / {len(valid)} ({100*(valid['delay_hours']>24).sum()/len(valid):.1f}%)")
    print(f"  date: {visits['arrival_time'].min()} -> {visits['arrival_time'].max()}")

    daily = build_daily()
    raw_dir = s.abs_data_dir / "raw"
    raw_dir.mkdir(parents=True, exist_ok=True)
    d_out = raw_dir / "ais_daily.parquet"
    daily.to_parquet(d_out, index=False)
    log.info(f"Wrote {len(daily)} daily rows -> {d_out}")
    print(f"\ndaily: {len(daily)} days, sample:")
    print(daily.head(3).to_string(index=False))

    # Merge into checkpoint_outcomes: append LA real visits alongside CPPI annual rows
    cppi_path = silver_dir / "checkpoint_outcomes.parquet"
    if cppi_path.exists():
        cppi = pd.read_parquet(cppi_path)
        # Keep CPPI annual rows + add per-visit LA rows (different granularity, flagged by observation_id prefix)
        cols = ["observation_id", "node_id", "checkpoint_id", "delay_hours", "delay_flag", "data_timestamp", "source", "label_source"]
        v_cols = [c for c in cols if c in visits.columns]
        v_sub = visits[v_cols].copy()
        # checkpoint_type for visits
        v_sub["checkpoint_type"] = "port"
        for c in ["port", "locode", "year", "cppi_score"]:
            if c not in v_sub.columns:
                v_sub[c] = None
        # Ensure cppi has same cols
        for c in v_sub.columns:
            if c not in cppi.columns:
                cppi[c] = None
        combined = pd.concat([cppi, v_sub], ignore_index=True).sort_values(["node_id", "data_timestamp"]).reset_index(drop=True)
        combined.to_parquet(cppi_path, index=False)
        print(f"\ncheckpoint_outcomes updated: {len(cppi)} CPPI + {len(v_sub)} AIS visits = {len(combined)} rows")
        log.info(f"Updated checkpoint_outcomes: {len(combined)} rows")

    # Update WAREHOUSE if needed
    try:
        storage.materialize_warehouse()
    except Exception as e:
        log.warning(f"materialize: {e}")


if __name__ == "__main__":
    main()
