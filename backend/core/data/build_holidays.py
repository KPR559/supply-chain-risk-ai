"""Build holidays calendar (Section 17) + temporal feature helpers (Section 16).

Inputs:
  raw_customs (25,326 rows: node_id, country, date, is_holiday, holiday_name,
               day_of_week, is_weekend, lpi_customs, customs_workload, 2019-now)

Outputs:
  data/silver/holidays.parquet              — Section 17 (552 holidays, 5 countries with coverage)
  data/features/temporal/temporal_features.parquet — Section 16 helpers (date-level calendar)

Section 17 schema: holiday_id, date, country_code, region, holiday_name,
  holiday_type, is_public_holiday, is_operational_holiday, holiday_duration_days

Section 16: day_of_week, week_of_year, month, quarter, is_weekend, season,
  days_to_holiday, days_since_holiday, etc. — joined at feature build time.

Note: AE/IN/LK have no Nager.Date coverage (flagged as wb-lpi-only) — their
holidays remain NULL until a second source is added. This is honest, not fabricated.

Usage:
  python -m backend.core.data.build_holidays
"""
from __future__ import annotations

import hashlib

import pandas as pd

from backend.core import storage
from backend.core.config import get_settings
from backend.core.logging_util import get_logger

log = get_logger(__name__)


def build() -> tuple[pd.DataFrame, pd.DataFrame]:
    con = storage.connect()
    try:
        df = pd.read_sql("SELECT * FROM raw_customs WHERE is_holiday=1", con)
        all_dates = pd.read_sql("SELECT DISTINCT date, country FROM raw_customs", con)
    finally:
        con.close()

    df["date"] = pd.to_datetime(df["date"]).dt.normalize()
    all_dates["date"] = pd.to_datetime(all_dates["date"]).dt.normalize()

    # -- holidays.parquet (Section 17) --
    holidays = []
    for _, r in df.iterrows():
        hid = hashlib.md5(f"{r['country']}:{r['date'].date()}:{r['holiday_name']}".encode()).hexdigest()[:12]
        holidays.append({
            "holiday_id": f"HOL-{hid}",
            "date": r["date"].normalize(),
            "country_code": r["country"],
            "region": "",
            "holiday_name": r["holiday_name"] or "",
            "holiday_type": "public",
            "is_public_holiday": 1,
            "is_operational_holiday": 1,  # port/customs closure
            "holiday_duration_days": 1,
            "source": r.get("source", "nager+wb-lpi"),
        })
    hol_df = pd.DataFrame(holidays).sort_values(["country_code", "date"]).reset_index(drop=True)

    # -- temporal helpers --
    # Daily calendar with holiday proximity features per country
    all_dates = all_dates.sort_values(["country", "date"]).reset_index(drop=True)
    hol_dates = set(zip(hol_df["country_code"], hol_df["date"].dt.normalize()))
    # For each country, compute days_to/since holiday
    temporal_rows = []
    for country, g in all_dates.groupby("country"):
        g = g.sort_values("date").reset_index(drop=True)
        g["is_holiday"] = g.apply(lambda r: 1 if (r["country"], r["date"]) in hol_dates else 0, axis=1)
        # Days to next / since last holiday
        g["date_ordinal"] = g["date"].apply(lambda d: d.toordinal())
        holiday_ordinals = sorted(g.loc[g["is_holiday"] == 1, "date_ordinal"].tolist())
        if holiday_ordinals:
            import bisect
            to_next, since_last = [], []
            for o in g["date_ordinal"]:
                idx = bisect.bisect_left(holiday_ordinals, o)
                to_next.append(holiday_ordinals[idx] - o if idx < len(holiday_ordinals) else 365)
                idx2 = bisect.bisect_right(holiday_ordinals, o) - 1
                since_last.append(o - holiday_ordinals[idx2] if idx2 >= 0 else 365)
            g["days_to_holiday"] = to_next
            g["days_since_holiday"] = since_last
        else:
            g["days_to_holiday"] = 365
            g["days_since_holiday"] = 365
        g["day_of_week"] = g["date"].dt.dayofweek
        g["week_of_year"] = g["date"].dt.isocalendar().week.astype(int)
        g["month"] = g["date"].dt.month
        g["quarter"] = g["date"].dt.quarter
        g["day_of_year"] = g["date"].dt.dayofyear
        g["is_weekend"] = (g["day_of_week"] >= 5).astype(int)
        g["season"] = g["month"].map({12: "winter", 1: "winter", 2: "winter",
                                       3: "spring", 4: "spring", 5: "spring",
                                       6: "summer", 7: "summer", 8: "summer",
                                       9: "autumn", 10: "autumn", 11: "autumn"})
        g["holiday_period_flag"] = ((g["days_to_holiday"] <= 2) | (g["days_since_holiday"] <= 1)).astype(int)
        temporal_rows.append(g)

    temporal = pd.concat(temporal_rows, ignore_index=True).sort_values(["country", "date"]).reset_index(drop=True)
    temporal = temporal[["country", "date", "day_of_week", "week_of_year", "month", "quarter",
                         "day_of_year", "is_weekend", "season", "is_holiday",
                         "days_to_holiday", "days_since_holiday", "holiday_period_flag"]]

    s = get_settings()
    storage.ensure_storage_dirs()
    silver = s.abs_data_dir / "silver"
    feat_temporal = s.abs_data_dir / "features" / "temporal"
    silver.mkdir(parents=True, exist_ok=True)
    feat_temporal.mkdir(parents=True, exist_ok=True)

    hol_path = silver / "holidays.parquet"
    hol_df.to_parquet(hol_path, index=False)
    tmp_path = feat_temporal / "temporal_features.parquet"
    temporal.to_parquet(tmp_path, index=False)
    log.info(f"Wrote {len(hol_df)} holidays -> {hol_path}")
    log.info(f"Wrote {len(temporal)} temporal rows -> {tmp_path}")

    return hol_df, temporal


def main() -> None:
    hol, tmp = build()
    print(f"holidays: {len(hol)} rows")
    print(hol.groupby("country_code").size().to_string())
    print(f"\ntemporal: {len(tmp)} rows")
    print(tmp.head(3).to_string(index=False))
    print(f"\nholiday_period_flag: {int(tmp['holiday_period_flag'].sum())} / {len(tmp)}")


if __name__ == "__main__":
    main()
