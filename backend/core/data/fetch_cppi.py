"""Fetch World Bank CPPI (Container Port Performance Index) — real observed port time.

Source: World Bank CPPI 2020-2024 Annex (free, CC BY 3.0 IGO).
URL: https://openknowledge.worldbank.org → Annex: CPPI 2020-2025 Excel (67 KB).
Existing local copy: data/raw/cppi_annex.xlsx (downloaded 2026-09-14).

Coverage: all 9 LOGIX ports are in the annex (verified):
  Shanghai CNSHG, Singapore SGSIN, Busan KRPUS, Rotterdam NLRTM,
  Los Angeles USLAX, New York USNYC (New York & New Jersey),
  Jebel Ali AEJEA (Dubai), Jawaharlal Nehru Port INNSA (Mumbai),
  Colombo LKCMB — all with CPPI 2020-2024 scores.

CPPI scores are real observed vessel-time-in-port indices (higher = faster).
Berth hours % is a direct observed operational metric.

Output:
  - data/raw/cppi.parquet          (per-port per-year, observed)
  - data/raw/cppi_history.parquet  (same, with node_id mapping)
  - DuckDB table raw_cppi

Schema: port, locode, node_id, territory, year, cppi_score,
        rank, berth_hours_pct, statistical_index, administrative_index, source
"""
from __future__ import annotations

import urllib.request
from pathlib import Path

import pandas as pd

from backend.core import storage
from backend.core.config import get_settings
from backend.core.logging_util import get_logger

log = get_logger(__name__)

CPPI_URL = "https://openknowledge.worldbank.org/server/api/core/bitstreams/6d1086f0-13ed-4d69-92ad-11d93f3e7df6/content"

# LOCODE → LOGIX node_id
LOCODE_TO_NODE = {
    "CNSHG": "shanghai",
    "SGSIN": "singapore",
    "KRPUS": "busan",
    "NLRTM": "rotterdam",
    "USLAX": "los_angeles",
    "USNYC": "new_york",
    "AEJEA": "dubai",
    "INNSA": "mumbai",      # Jawaharlal Nehru Port = serves Mumbai
    "LKCMB": "colombo",
}


def _download_if_needed() -> Path:
    s = get_settings()
    raw_dir = s.abs_data_dir / "raw"
    raw_dir.mkdir(parents=True, exist_ok=True)
    xlsx = raw_dir / "cppi_annex.xlsx"
    if xlsx.exists() and xlsx.stat().st_size > 1000:
        return xlsx
    log.info("Downloading CPPI annex ...")
    data = urllib.request.urlopen(CPPI_URL, timeout=60).read()
    xlsx.write_bytes(data)
    log.info(f"Saved {len(data)} bytes -> {xlsx}")
    return xlsx


def fetch_all() -> pd.DataFrame:
    xlsx = _download_if_needed()
    wb_rows = []
    import openpyxl
    wb = openpyxl.load_workbook(str(xlsx), read_only=True, data_only=True)
    ws = wb["Annex"]
    headers = [c.value for c in ws[1]]
    # Columns: Port, LOCODE, Territory, ..., CPPI 2020..2024, Rank, Berth hours %, ...
    cppi_cols = {f"CPPI {y}": y for y in [2020, 2021, 2022, 2023, 2024]}
    idx = {h: i for i, h in enumerate(headers) if h}

    for row in ws.iter_rows(min_row=2, values_only=True):
        port = (row[idx["Port"]] or "").strip() if row[idx["Port"]] else ""
        locode = (row[idx["LOCODE"]] or "").strip() if row[idx["LOCODE"]] else ""
        if not port or not locode:
            continue
        berth = row[idx.get("Berth hours in % of port hours", -1)] if "Berth hours in % of port hours" in idx else None
        stat_idx = row[idx.get("Statistical Index", -1)] if "Statistical Index" in idx else None
        adm_idx = row[idx.get("Administrative Index", -1)] if "Administrative Index" in idx else None
        rank = row[idx.get("Rank", -1)] if "Rank" in idx else None
        for h, year in cppi_cols.items():
            if h not in idx:
                continue
            val = row[idx[h]]
            if val == "" or val is None:
                continue
            try:
                score = float(str(val).replace(",", "").strip())
            except ValueError:
                continue
            wb_rows.append({
                "port": port, "locode": locode,
                "node_id": LOCODE_TO_NODE.get(locode, ""),
                "territory": row[idx.get("Territory", 0)] or "",
                "year": int(year), "cppi_score": score,
                "rank": int(rank) if rank not in (None, "") else None,
                "berth_hours_pct": float(berth) if berth not in (None, "") else None,
                "statistical_index": float(stat_idx) if stat_idx not in (None, "") else None,
                "administrative_index": float(adm_idx) if adm_idx not in (None, "") else None,
                "source": "World Bank CPPI 2020-2024 Annex (CC BY 3.0)",
            })
    wb.close()

    df = pd.DataFrame(wb_rows)
    # Also keep a node-focused view (our 9 ports only, for ML join)
    s = get_settings()
    storage.ensure_storage_dirs()
    raw_dir = s.abs_data_dir / "raw"
    # Full table
    full = raw_dir / "cppi.parquet"
    df.to_parquet(full, index=False)
    # History view mapped to node_id (for joining to warehouse)
    hist = raw_dir / "cppi_history.parquet"
    node_df = df[df["node_id"] != ""].copy()
    node_df.to_parquet(hist, index=False)
    log.info(f"Wrote {len(df)} rows (all ports) -> {full}")
    log.info(f"Wrote {len(node_df)} rows (9 LOGIX ports) -> {hist}")

    counts = storage.materialize_warehouse()
    log.info(f"Warehouse: {counts}")
    return df


def main() -> None:
    df = fetch_all()
    node_df = df[df["node_id"] != ""]
    print(f"all_ports={len(df)} logix_ports={len(node_df)} years={sorted(df['year'].unique())}")
    print("\nOur 9 ports (CPPI 2024):")
    d24 = node_df[node_df["year"] == 2024].sort_values("cppi_score", ascending=False)
    print(d24[["node_id", "port", "cppi_score", "rank", "berth_hours_pct"]].to_string(index=False))
    print("\nCPPI time series (mean across our 9 ports):")
    print(node_df.groupby("year")["cppi_score"].mean().to_string())


if __name__ == "__main__":
    main()
