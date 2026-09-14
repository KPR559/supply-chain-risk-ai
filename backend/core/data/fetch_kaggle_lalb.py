"""Fetch LA/LB AIS delay dataset from Kaggle (real observed delay_minutes).

Source: nguyenductuandat/lalb-ais-port-congestion-62023-122025
  https://www.kaggle.com/datasets/nguyenductuandat/lalb-ais-port-congestion-62023-122025
  21.7M AIS pings → 6,562 port visits, 53 engineered cols, target = delay_minutes
  (exact physical waiting time before mooring — derived from observed AIS status).

Requires: one-time Kaggle setup
  1. Create account at kaggle.com → Account → Create New API Token → kaggle.json
  2. Place kaggle.json at %USERPROFILE%\\.kaggle\\kaggle.json  (or $HOME/.kaggle/)
  3. pip install kaggle  (already in this repo's env)

Without kaggle.json the fetcher exits cleanly and documents the step.

Output:
  - data/raw/kaggle_lalb/*.parquet (unzipped from Kaggle)
  - DuckDB view raw_kaggle_lalb via materialize_warehouse (if landed)

Schema (key cols): visit_id, mmsi, vessel_name, vessel_type,
  delay_minutes (TARGET), ship_density, is_in_waiting_area,
  wind_speed_10m, wave_height, time_in_zone_hours, ...
"""
from __future__ import annotations

import os
import subprocess
import zipfile
from pathlib import Path

import pandas as pd

from backend.core import storage
from backend.core.config import get_settings
from backend.core.logging_util import get_logger

log = get_logger(__name__)

KAGGLE_SLUG = "nguyenductuandat/lalb-ais-port-congestion-62023-122025"


def _have_kaggle_token() -> bool:
    p = Path.home() / ".kaggle" / "kaggle.json"
    if p.exists():
        return True
    # also check env var
    if os.environ.get("KAGGLE_USERNAME") and os.environ.get("KAGGLE_KEY"):
        return True
    log.warning(
        "Kaggle credentials not found — skipping Kaggle fetcher.\n"
        "Setup (one-time, free):\n"
        "  1. kaggle.com → Account → Create New API Token → saves kaggle.json\n"
        "  2. Move kaggle.json to %USERPROFILE%\\.kaggle\\kaggle.json\n"
        "  3. Re-run: python -m backend.core.data.fetch_kaggle_lalb"
    )
    return False


def fetch_all() -> pd.DataFrame | None:
    if not _have_kaggle_token():
        return None

    s = get_settings()
    outdir = s.abs_data_dir / "raw" / "kaggle_lalb"
    outdir.mkdir(parents=True, exist_ok=True)

    # kaggle CLI download
    cmd = ["kaggle", "datasets", "download", "-d", KAGGLE_SLUG, "-p", str(outdir), "--unzip"]
    log.info(f"Running: {' '.join(cmd)}")
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=600)
    if result.returncode != 0:
        log.warning(f"kaggle download failed: {result.stderr[:500]}")
        return None
    log.info(result.stdout[:500])

    # inventory
    files = list(outdir.glob("*.parquet")) + list(outdir.glob("*.csv"))
    log.info(f"Landed {len(files)} files in {outdir}: {[f.name for f in files[:5]]}")

    # quick peek at delay_minutes if parquet landed
    for f in files:
        if f.suffix == ".parquet":
            try:
                df = pd.read_parquet(f)
                if "delay_minutes" in df.columns:
                    log.info(f"{f.name}: delay_minutes mean={df['delay_minutes'].mean():.1f} "
                             f"median={df['delay_minutes'].median():.1f} n={len(df)}")
                    print(df["delay_minutes"].describe().to_string())
                    return df
            except Exception as e:
                log.warning(f"peek {f.name}: {e}")
    return pd.DataFrame()


def main() -> None:
    df = fetch_all()
    if df is None or (hasattr(df, "empty") and df.empty):
        print("Kaggle LA/LB not landed — set up kaggle.json and retry.")
        return
    print(f"rows={len(df)} cols={list(df.columns)[:10]}")


if __name__ == "__main__":
    main()
