"""Analytical storage layer built on Parquet + DuckDB.

Parquet files under ``data/<layer>/`` are the raw material; the DuckDB
warehouse (``data/warehouse.duckdb`` by default, see ``DUCKDB_PATH``) is the
queryable database the runtime reads from. ``materialize_warehouse()``
rebuilds all tables from Parquet and runs at the end of data generation.
Large analytical data is never blindly read into memory; DuckDB pushes down
predicates.
"""
from __future__ import annotations

import duckdb
import pandas as pd
from pathlib import Path
from typing import Dict, Iterable, Optional

from backend.core.config import get_settings
from backend.core.logging_util import get_logger

log = get_logger(__name__)

# warehouse table -> (parquet layer, parquet dataset name)
WAREHOUSE_SOURCES: Dict[str, tuple] = {
    "raw_events": ("raw", "events.parquet"),
    "silver_cleaned_events": ("silver", "cleaned_events.parquet"),
    "gold_node_observations": ("gold", "node_observations"),
    "raw_alerts": ("raw", "alerts.parquet"),
    "raw_conflict_events": ("raw", "conflict_events.parquet"),
    "raw_weather": ("raw", "weather.parquet"),
    "raw_weather_history": ("raw", "weather_history.parquet"),
    "raw_congestion": ("raw", "congestion.parquet"),
    "raw_customs": ("raw", "customs.parquet"),
    "raw_cppi": ("raw", "cppi.parquet"),
    "raw_cppi_history": ("raw", "cppi_history.parquet"),
    "raw_ais_daily": ("raw", "ais_daily.parquet"),
    "silver_ais_visits": ("silver", "ais_visits.parquet"),
    "silver_checkpoint_outcomes": ("silver", "checkpoint_outcomes.parquet"),
    "silver_checkpoints": ("silver", "checkpoints.parquet"),
    "silver_route_edges": ("silver", "route_edges.parquet"),
    "silver_holidays": ("silver", "holidays.parquet"),
}


def ensure_storage_dirs() -> None:
    s = get_settings()
    for d in (s.abs_data_dir / "raw", s.abs_data_dir / "silver", s.abs_data_dir / "gold"):
        d.mkdir(parents=True, exist_ok=True)


def _dt_prefix(s) -> str:
    """year=YYYY/month=MM partition prefix for a pandas Timestamp."""
    year = s.year
    month = f"{s.month:02d}"
    return f"{year:04d}/{month}"


def write_partitioned(df: pd.DataFrame, name: str, order: Iterable[str],
                      layer: str = "gold", partition_cols: Optional[list] = None) -> Path:
    """Write a dataframe partitioned by year/month into `data/<layer>/<name>/`.

    A `_metadata.parquet` sidecar stores the schema and a manifest of files for
    cheap, correct re-reads.
    """
    s = get_settings()
    base = s.abs_data_dir / layer / name
    import json
    if partition_cols:
        part = {c: (_dt_prefix(v) if c in ("timestamp", "date") else str(v))
                for c in partition_cols for v in []}
        # Simpler: partition by year/month of 'timestamp' when present.
    df = df.copy()
    if "timestamp" in df.columns:
        ts = pd.to_datetime(df["timestamp"])
        df["_year"] = ts.dt.year.astype(int)
        df["_month"] = ts.dt.month.astype(int)

    # Build partition list (year, month)
    parts = []
    if "_year" in df.columns:
        for (y, m), sub in df.groupby(["_year", "_month"]):
            pdir = base / f"year={y:04d}" / f"month={m:02d}"
            pdir.mkdir(parents=True, exist_ok=True)
            sub.drop(columns=["_year", "_month"]).to_parquet(pdir / f"part.parquet", index=False)
            parts.append(str(pdir.relative_to(base)))
    else:
        base.mkdir(parents=True, exist_ok=True)
        df.to_parquet(base / "part.parquet", index=False)
        parts.append(".")

    (base / "_metadata.parquet").write_text(
        json.dumps({
            "name": name,
            "columns": list(df.columns),
            "parts": parts,
            "order": list(order),
        }),
        encoding="utf-8",
    )
    return base


def column_order(df: pd.DataFrame, order: Iterable[str]) -> pd.DataFrame:
    """Re-order a frame's columns, keeping unknown/named extras at the end."""
    cols = [c for c in order if c in df.columns]
    cols += [c for c in df.columns if c not in cols]
    return df[cols]


def read_partitioned(name: str, layer: str = "gold",
                     where: Optional[str] = None,
                     columns: Optional[list] = None) -> pd.DataFrame:
    """Read a partitioned dataset (optionally by year/month) through DuckDB.

    `where` is an optional SQL condition (seconds) pushing down predicates,
    e.g. ``"year>=2023 AND node_id='suez'"``.
    """
    s = get_settings()
    base = s.abs_data_dir / layer / name
    if not base.exists():
        raise FileNotFoundError(f"Dataset not found: {base}")
    files = list(base.rglob("*.parquet"))
    # Exclude metadata sidecar
    files = [f for f in files if f.name != "_metadata.parquet"]
    if not files:
        return pd.DataFrame()

    cols = "*"
    if columns:
        cols = ", ".join(columns)
    sql = f"SELECT {cols} FROM read_parquet({[str(f) for f in files]!r})"
    if where:
        sql += f" WHERE {where}"
    con = duckdb.connect(database=":memory:")
    try:
        return con.execute(sql).df()
    finally:
        con.close()


def query_duck(sql: str) -> pd.DataFrame:
    """Run an arbitrary DuckDB query on partitioned gold data via a registered view."""
    con = duckdb.connect(database=":memory:")
    try:
        for layer in ("gold", "silver", "raw"):
            cfg = _scan_config(layer)
            for name, files in cfg.items():
                if files:
                    con.register(f"{layer}_{name}", files if len(files) > 1 else files[0])
        return con.execute(sql).df()
    finally:
        con.close()


def _scan_config(layer: str):
    s = get_settings()
    base = s.abs_data_dir / layer
    out = {}
    if base.exists():
        for d in base.iterdir():
            if d.is_dir():
                files = [str(f) for f in d.rglob("*.parquet") if f.name != "_metadata.parquet"]
                if files:
                    out[d.name] = files
    return out


def list_datasets() -> list:
    s = get_settings()
    result = []
    for layer in ("raw", "silver", "gold"):
        d = s.abs_data_dir / layer
        if d.exists():
            for sub in d.iterdir():
                if sub.is_dir():
                    result.append({"layer": layer, "name": sub.name})
    return result


# ---------------------------------------------------------------------------
# DuckDB warehouse (persistent database file, rebuilt from Parquet)
# ---------------------------------------------------------------------------

def warehouse_path() -> Path:
    p = get_settings().abs_duckdb_path
    p.parent.mkdir(parents=True, exist_ok=True)
    return p


def connect(read_only: bool = False):
    """Open a connection to the warehouse database file."""
    return duckdb.connect(database=str(warehouse_path()), read_only=read_only)


def warehouse_tables() -> list:
    """Names of tables currently in the warehouse ([] if none built yet)."""
    if not get_settings().abs_duckdb_path.exists():
        return []
    con = connect(read_only=True)
    try:
        return sorted(r[0] for r in con.execute("SHOW TABLES").fetchall())
    finally:
        con.close()


def materialize_warehouse() -> Dict[str, int]:
    """(Re)build every warehouse table from the Parquet layers.

    Missing datasets are skipped so partial data still yields a usable DB.
    Returns {table: row_count}.
    """
    s = get_settings()
    counts: Dict[str, int] = {}
    con = connect()
    try:
        for table, (layer, name) in WAREHOUSE_SOURCES.items():
            base = s.abs_data_dir / layer / name
            if base.is_dir():
                files = sorted(
                    str(f) for f in base.rglob("*.parquet")
                    if f.name != "_metadata.parquet"
                )
            elif base.is_file():
                files = [str(base)]
            else:
                continue
            if not files:
                continue
            files_sql = "[" + ", ".join(
                "'" + f.replace("'", "''") + "'" for f in files) + "]"
            con.execute(
                f"CREATE OR REPLACE TABLE {table} AS "
                f"SELECT * FROM read_parquet({files_sql})"
            )
            counts[table] = con.execute(
                f"SELECT COUNT(*) FROM {table}").fetchone()[0]
    finally:
        con.close()
    log.info(f"Warehouse materialized: {warehouse_path()} tables={counts}")
    return counts


def read_table(name: str, where: Optional[str] = None,
               columns: Optional[list] = None) -> pd.DataFrame:
    """Read a warehouse table (optional SQL filter / column projection).

    Raises FileNotFoundError when the warehouse or the table does not exist
    yet — callers fall back to Parquet or ask for a data generate.
    """
    if name not in warehouse_tables():
        raise FileNotFoundError(
            f"Warehouse table not found: {name} "
            f"({get_settings().abs_duckdb_path})")
    cols = "*" if not columns else ", ".join(columns)
    sql = f"SELECT {cols} FROM {name}"
    if where:
        sql += f" WHERE {where}"
    con = connect(read_only=True)
    try:
        return con.execute(sql).df()
    finally:
        con.close()
