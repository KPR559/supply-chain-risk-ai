"""Analytical storage layer built on Parquet + DuckDB.

Provides reusable data-access functions for the raw / silver / gold layers and
a small DuckDB query helper. Large analytical data is never blindly read into
memory; DuckDB pushes down predicates.
"""
from __future__ import annotations

import duckdb
import pandas as pd
from pathlib import Path
from typing import Iterable, Optional

from backend.core.config import get_settings


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
