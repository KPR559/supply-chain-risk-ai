"""Fetch per-port customs/holiday data (free, keyless) into DuckDB.

Sources:
  - Nager.Date (https://date.nager.at) public holidays per port country, 2019-now
  - World Bank LPI customs sub-index (LP.LPI.CUST.XQ, 1-5, 2022 vintage) as
    static per-country clearance-efficiency baseline

Output:
  - data/raw/customs.parquet
  - DuckDB table raw_customs

Schema per row (port x date):
  node_id, country, date, is_holiday, holiday_name, day_of_week, is_weekend,
  lpi_customs, customs_workload [0-1], fetched_at, source

customs_workload matches gold_node_observations.customs_workload semantics:
  workload = 0.6*holiday + 0.2*weekend + 0.2*(5-lpi)/4
(holiday dominates like the synthetic generator; weekend half weight;
structural LPI gap is the slow background).

Usage:
  python -m backend.core.data.fetch_customs
"""
from __future__ import annotations

import json
import time
import urllib.request
from datetime import date

import pandas as pd

from backend.core import storage
from backend.core.config import get_settings
from backend.core.data.global_nodes import PORT_NODES
from backend.core.logging_util import get_logger

log = get_logger(__name__)

NAGER = "https://date.nager.at/api/v3/publicholidays"

# Verified via World Bank API LP.LPI.CUST.XQ (2022 vintage, LPI 2023 round).
LPI_CUSTOMS = {
    "SG": 4.2, "KR": 3.9, "NL": 3.9, "US": 3.7,
    "AE": 3.7, "CN": 3.3, "IN": 3.0, "LK": 2.5,
}


# Nager.Date does not cover AE/IN/LK — supplemented via `holidays` package
# (offline, covers UAE 14/yr, India 18/yr, Sri Lanka 27/yr).
_FALLBACK_COUNTRIES = {"AE", "IN", "LK"}


def _fetch_holidays(country: str, year: int, tries: int = 3):
    if country in _FALLBACK_COUNTRIES:
        try:
            import holidays as hol_pkg
            mapping = {"AE": hol_pkg.UnitedArabEmirates, "IN": hol_pkg.India, "LK": hol_pkg.SriLanka}
            cls = mapping.get(country)
            if cls is None:
                return []
            hol = cls(years=year)
            return [{"date": d.isoformat(), "localName": name, "name": name} for d, name in hol.items()]
        except Exception as e:
            log.warning(f"holidays fallback {country}/{year}: {e}")
            return []
    for a in range(tries):
        try:
            req = urllib.request.Request(f"{NAGER}/{year}/{country}",
                                         headers={"User-Agent": "supply-chain-risk-ai/1.0"})
            with urllib.request.urlopen(req, timeout=30) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except Exception as e:
            log.warning(f"holidays {country}/{year} attempt {a}: {e}")
            time.sleep(3 * (a + 1))
    return []


def fetch_all(start_year: int = 2019) -> pd.DataFrame:
    today = date.today()
    # holiday lookup per country
    hol = {}  # (country, date_str) -> name
    countries = sorted({n["country"] for n in PORT_NODES if n.get("country")})
    for c in countries:
        for y in range(start_year, today.year + 1):
            for h in _fetch_holidays(c, y):
                hol[(c, h["date"])] = h.get("localName") or h.get("name", "")
            time.sleep(1)  # be nice to the free API
        log.info(f"holidays ok: {c}")

    idx = pd.date_range("2019-01-01", today.strftime("%Y-%m-%d"), freq="D")
    rows = []
    for n in PORT_NODES:
        c = n["country"]
        lpi = LPI_CUSTOMS.get(c, 3.5)
        gap = (5.0 - lpi) / 4.0
        for ts in idx:
            d = ts.strftime("%Y-%m-%d")
            name = hol.get((c, d), "")
            is_hol = 1 if name else 0
            dow = ts.dayofweek
            wknd = 1 if dow >= 5 else 0
            wl = round(float(min(1.0, 0.6 * is_hol + 0.2 * wknd + 0.2 * gap)), 4)
            rows.append({
                "node_id": n["id"], "country": c, "date": d,
                "is_holiday": is_hol, "holiday_name": name,
                "day_of_week": dow, "is_weekend": wknd,
                "lpi_customs": lpi, "customs_workload": wl,
                "fetched_at": str(today),
                "source": ("holidays-pkg+wb-lpi" if c in _FALLBACK_COUNTRIES
                           else "nager+wb-lpi"),
            })
    df = pd.DataFrame(rows)
    s = get_settings()
    storage.ensure_storage_dirs()
    out = s.abs_data_dir / "raw" / "customs.parquet"
    df.to_parquet(out, index=False)
    log.info(f"Wrote {len(df)} rows -> {out}")
    counts = storage.materialize_warehouse()
    log.info(f"Warehouse: {counts}")
    return df


def main() -> None:
    df = fetch_all()
    print(f"ports={df['node_id'].nunique()} rows={len(df)}")
    print(df.groupby("node_id")["customs_workload"].max().to_string())
    print("holiday hits:", int(df["is_holiday"].sum()))


if __name__ == "__main__":
    main()
