"""Realistic synthetic data generator for the Frankfurt -> India corridor.

The generator is **clearly synthetic** but models real-world relationships:

* yearly + weekly seasonality
* node-specific behaviour (canals, ports, customs behave differently)
* port / canal congestion that clusters and cascades downstream
* weather severity with occasional extreme storms
* geopolitical / conflict events (esp. around Suez) with recency decay
* holiday effects on customs workload
* rare large disruptions (blockage, strike, regime change)
* correlated upstream -> downstream delay propagation
* rare extreme events in the tail

All randomness is seeded so the demo is reproducible.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from core.graph.topology import NODE_DEFS, node_index

# ---------------------------------------------------------------------------
# Node risk profiles (how each node responds to the latent drivers)
# ---------------------------------------------------------------------------
# base: baseline delay hours (normal operations)
# weather_sens: extra delay hours per unit weather_severity
# cong_sens: extra delay hours per unit congestion_index
# conflict_sens: extra delay hours per unit conflict_risk_score
# seasonal_amp: seasonal swing (hours)
# cong_base: typical congestion level
# cong_ar: congestion autocorrelation
# storm_rate: expected extra-storms per year that generate extreme congestion
PROFILES = {
    "frankfurt":        dict(base=1.5, weather_sens=0.8,  cong_sens=0.8,  conflict_sens=0.0, seasonal_amp=1.0, cong_base=0.15, cong_ar=0.6,  storm_rate=2.0, noise=1.5),
    "european_hub":     dict(base=2.5, weather_sens=1.2,  cong_sens=1.2,  conflict_sens=0.3, seasonal_amp=1.5, cong_base=0.30, cong_ar=0.7,  storm_rate=4.0, noise=2.0),
    "suez":             dict(base=5.0, weather_sens=2.5,  cong_sens=3.5,  conflict_sens=7.0, seasonal_amp=3.0, cong_base=0.45, cong_ar=0.85, storm_rate=3.0, noise=5.0),
    "cape_of_good_hope":dict(base=6.0, weather_sens=3.5, cong_sens=2.0,  conflict_sens=0.8, seasonal_amp=2.5, cong_base=0.25, cong_ar=0.7,  storm_rate=6.0, noise=5.0),
    "indian_ocean":     dict(base=2.0, weather_sens=2.0,  cong_sens=1.2,  conflict_sens=1.0, seasonal_amp=2.0, cong_base=0.20, cong_ar=0.7,  storm_rate=5.0, noise=2.5),
    "colombo":          dict(base=3.5, weather_sens=1.5,  cong_sens=2.0,  conflict_sens=0.5, seasonal_amp=1.5, cong_base=0.40, cong_ar=0.8,  storm_rate=4.0, noise=2.5),
    "dubai":            dict(base=3.0, weather_sens=1.0,  cong_sens=1.8,  conflict_sens=1.5, seasonal_amp=1.0, cong_base=0.35, cong_ar=0.75, storm_rate=3.0, noise=2.0),
    "mumbai":           dict(base=6.0, weather_sens=2.0, cong_sens=3.0, conflict_sens=1.2, seasonal_amp=3.0, cong_base=0.50, cong_ar=0.8,  storm_rate=5.0, noise=3.5),
    "customs":          dict(base=5.5, weather_sens=0.3,  cong_sens=2.5,  conflict_sens=0.0, seasonal_amp=2.5, cong_base=0.55, cong_ar=0.8,  storm_rate=2.0, noise=3.0),
    "final_destination":dict(base=0.5, weather_sens=0.5,  cong_sens=0.5,  conflict_sens=0.0, seasonal_amp=0.5, cong_base=0.10, cong_ar=0.5,  storm_rate=1.0, noise=1.0),
}

# Days with a yearly-period sinusoidal seasonal pattern scaled per node.
DOW_EFFECT = {0: 1.0, 1: 0.7, 2: 0.5, 3: 0.5, 4: 0.6, 5: 0.9, 6: 1.4}  # weekends busier for customs


class SyntheticDataGenerator:
    """Generates the synthetic gold + raw datasets."""

    def __init__(self, seed: int = 42, years: int = 3, end_date: str = None):
        self.seed = seed
        self.rng = np.random.default_rng(seed)
        self.end = pd.Timestamp(end_date) if end_date else pd.Timestamp.today().normalize()
        self.start = self.end - pd.DateOffset(years=years)
        self.index = pd.date_range(self.start, self.end, freq="D")
        self.n = len(self.index)
        self.node_index = node_index()

    # ------------------------------------------------------------------
    def _seasonal(self, doy, amp, phase=0.0):
        return amp * np.sin(2 * np.pi * (doy - 1 + phase) / 365.25)

    def _weather(self, doy, storm_events):
        rng = self.rng
        n = self.n
        weather = np.zeros(n)
        phi = 0.9
        for i in range(n):
            if i == 0:
                weather[i] = rng.normal(0, 0.3)
            else:
                weather[i] = phi * weather[i - 1] + rng.normal(0, 0.35)
        # seasonal weather variation
        weather = weather + 0.8 * np.sin(2 * np.pi * (doy - 100) / 365.25)
        # storms -> extreme weather
        for ed in storm_events:
            idx = np.searchsorted(self.index.values.astype("datetime64[D]"), np.datetime64(ed, "D"))
            if 0 <= idx < n:
                weather[idx] += rng.uniform(2.5, 4.0)
                if idx + 1 < n:
                    weather[idx + 1] += rng.uniform(1.0, 2.0)
        weather = np.clip(weather, -2.0, 5.0)
        # rescale to roughly [0,1] severity
        severity = (weather - weather.min()) / max((weather.max() - weather.min()), 1e-9)
        return severity

    # ------------------------------------------------------------------
    def _congestion(self, profile, upstream_delay, storm_events):
        rng = self.rng
        n = self.n
        phi = profile["cong_ar"]
        cong = np.zeros(n)
        base = profile["cong_base"]
        for i in range(n):
            if i == 0:
                cong[i] = base + rng.normal(0, 0.05)
            else:
                prev = cong[i - 1]
                cong[i] = prev * phi + (1 - phi) * base + rng.normal(0, 0.06)
        # congestion spikes from storms
        for ed in storm_events:
            idx = np.searchsorted(self.index.values.astype("datetime64[D]"), np.datetime64(ed, "D"))
            if 0 <= idx < n:
                push = rng.uniform(0.2, 0.5)
                for k in range(min(3, n - idx)):
                    cong[idx + k] = min(cong[idx + k] + push * (1 - 0.4 * k), 1.0)
        # congestion influenced by upstream delay (cascade)
        cong = cong + 0.15 * np.clip(upstream_delay / 50.0, 0, 1.0)
        cong = np.clip(cong, 0.0, 1.0)
        return cong

    # ------------------------------------------------------------------
    def _conflict_curve(self, doy):
        """Geopolitical risk: baseline + localized spikes with recency decay."""
        n = self.n
        conflict = np.zeros(n)
        # Overlay a defined set of conflict "campaigns" (dates -> severity)
        campaigns = []
        # e.g. regional instability affecting Suez/Red Sea
        if self.index[0] < pd.Timestamp("2023-10-07") < self.index[-1]:
            campaigns.append((pd.Timestamp("2023-10-07"), 2.6, 120))  # start, severity, decay_halflife_days
        if self.index[0] < pd.Timestamp("2024-01-01") < self.index[-1]:
            campaigns.append((pd.Timestamp("2024-01-01"), 1.8, 60))
        if self.index[0] < pd.Timestamp("2024-06-01") < self.index[-1]:
            campaigns.append((pd.Timestamp("2024-06-01"), 0.9, 30))
        for start, sev, halflife in campaigns:
            t0 = start
            times = (self.index - t0).days.values.astype(float)
            active = times >= 0
            decay = np.exp(-np.log(2) * np.maximum(times, 0) / halflife)
            conflict = conflict + active * sev * decay
        # Recent campaign relative to the generation end so the "current"
        # operating state shows measurable Suez / Red Sea risk.
        rec_start = self.end - pd.DateOffset(days=38)
        if rec_start > self.index[0]:
            times = (self.index - rec_start).days.values.astype(float)
            active = times >= 0
            decay = np.exp(-np.log(2) * np.maximum(times, 0) / 25.0)
            conflict = conflict + active * 2.2 * decay
        return np.clip(conflict, 0.0, 4.0)

    # ------------------------------------------------------------------
    def _events_for_node(self, node_id, doy):
        """Sample storm event dates for a node from its storm_rate."""
        rng = self.rng
        rate = PROFILES[node_id]["storm_rate"]
        n_events = int(self.n / 365.25 * rate)
        # Poisson-ish
        n_events = rng.poisson(max(1, self.n / 365.25 * rate))
        idx = rng.choice(self.n, size=n_events, replace=False)
        return self.index[idx]

    # ------------------------------------------------------------------
    def generate_node_observations(self) -> pd.DataFrame:
        """Produce the primary gold dataset: daily observations per node."""
        rng = self.rng
        rows = []
        doy = (self.index.dayofyear.values).astype(float)
        dow = self.index.dayofweek.values
        holiday = self._holiday_mask()
        conflict_global = self._conflict_curve(doy)
        # upstream delay cache for cascade (initialise near zero)
        upstream_delay = np.zeros(self.n)

        # Process nodes in a dependency-friendly order (origins first).
        for node in NODE_DEFS:
            nid = node["id"]
            prof = PROFILES[nid]
            storm_dates = self._events_for_node(nid, doy) if nid not in ("frankfurt", "final_destination") else self.index[0:0]
            stem = np.array([0.0] * self.n)
            storm_events = storm_dates if len(storm_dates) else pd.DatetimeIndex([])
            weather = self._weather(doy, storm_events)
            cong = self._congestion(prof, upstream_delay, storm_events)
            conflict = conflict_global * prof["conflict_sens"] / 3.0

            # seasonal
            seasonal = self._seasonal(doy, prof["seasonal_amp"], phase=nid.__hash__() % 365)
            # customs workload (holiday + weekday)
            workload = np.zeros(self.n)
            if nid == "customs":
                workload = 0.3 + 0.5 * (dow > 4) + 1.2 * holiday
                workload = workload / workload.max()
            # weekday effect for non-customs
            weekday = np.array([DOW_EFFECT[d] for d in dow])

            delay = (
                prof["base"]
                + seasonal
                + weather * prof["weather_sens"] * 2.5
                + cong * prof["cong_sens"] * 5.0
                + conflict * prof["conflict_sens"] * 4.0
                + workload * 3.0
                + rng.normal(0, prof["noise"], self.n)
            )
            # correlate downstream with upstream delay (cascade)
            if nid not in ("frankfurt", "final_destination"):
                delay = delay + 0.35 * upstream_delay * (1.0 if nid != "customs" else 0.5)
            delay = np.maximum(delay, -prof["noise"])

            # Extreme / disruption tail: occasional large events (regime=1)
            regime = np.zeros(self.n, dtype=int)
            disruption_rate = 0.02 if nid in ("suez", "mumbai", "customs", "colombo", "european_hub") else 0.008
            n_d = rng.poisson(self.n * disruption_rate)
            if n_d:
                idx = rng.choice(self.n, size=min(n_d, self.n), replace=False)
                for j in idx:
                    magnitude = rng.lognormal(mean=3.2, sigma=0.6)  # hours 10-100+
                    duration = int(rng.integers(3, 12))
                    for k in range(min(duration, self.n - j)):
                        decay = 1.0 - 0.12 * k
                        delay[j + k] = delay[j + k] + magnitude * decay
                        regime[j + k] = 1
                        cong[j + k] = min(cong[j + k] + 0.2 * (1 - 0.2 * k), 1.0)
                    if nid in ("suez", "mumbai"):
                        # blockage reflects downstream
                        upstream_delay[j:j + duration] += 0.3 * magnitude

            delay = np.round(np.maximum(delay, 0.0), 2)
            upd = np.clip(delay / 30.0, 0, 2.0)
            upstream_delay = upd

            for i in range(self.n):
                rows.append({
                    "node_id": nid,
                    "timestamp": self.index[i],
                    "delay_hours": float(delay[i]),
                    "congestion_index": round(float(cong[i]), 4),
                    "weather_severity": round(float(weather[i]), 4),
                    "conflict_risk_score": round(float(conflict[i] + conflict_global[i] * 0.2), 4),
                    "customs_workload": round(float(workload[i]), 4) if nid == "customs" else 0.0,
                    "is_holiday": int(holiday[i]),
                    "regime": int(regime[i]),
                })
        df = pd.DataFrame(rows)
        return df

    # ------------------------------------------------------------------
    def _holiday_mask(self) -> np.ndarray:
        """Holiday indicator from a fixed public-holiday calendar (partial list)."""
        years = list(range(self.start.year, self.end.year + 1))
        holidays = set()
        for y in years:
            for m, d in [(1, 1), (1, 26), (3, 8), (5, 1), (8, 15), (10, 2), (12, 25)]:
                try:
                    holidays.add(pd.Timestamp(y, m, d))
                except ValueError:
                    pass
        mask = np.array([pd.Timestamp(self.index[i].date()) in holidays for i in range(self.n)])
        return mask.astype(float)

    # ------------------------------------------------------------------
    def generate_raw_events(self, n_events: int = 4000, anomaly_rate: float = 0.04) -> pd.DataFrame:
        """Generate a raw stream of shipment-leg events with injected data-quality
        anomalies (duplicates, impossible values, bad timestamps, missing fields)."""
        rng = self.rng
        nodes = [n["id"] for n in NODE_DEFS]
        mode_speed = {
            "frankfurt": (60.0, 12.0),  # road
            "european_hub": (40.0, 15.0),  # rail
            "suez": (18.0, 6.0),  # canal transit
            "cape_of_good_hope": (30.0, 8.0),
            "indian_ocean": (32.0, 8.0),
            "colombo": (14.0, 5.0),
            "dubai": (28.0, 7.0),
            "mumbai": (16.0, 5.0),
            "customs": (10.0, 4.0),
            "final_destination": (55.0, 10.0),
        }
        records = []
        for _ in range(n_events):
            ts = self.start + pd.Timedelta(days=int(rng.integers(0, self.n)),
                                           hours=rng.integers(0, 24))
            src = nodes[rng.integers(0, len(nodes))]
            dst = nodes[rng.integers(0, len(nodes))]
            speed_mean, speed_std = mode_speed.get(src, (30.0, 10.0))
            speed = float(np.clip(rng.normal(speed_mean, speed_std), 2.0, 120.0))
            duration_h = float(np.clip(rng.gamma(8, 3), 1.0, 400.0))
            distance_km = round(speed * duration_h, 1)
            records.append({
                "event_id": f"EV{rng.integers(10_000, 999_999)}",
                "timestamp": ts,
                "src_node": src,
                "dst_node": dst,
                "duration_hours": round(duration_h, 2),
                "distance_km": distance_km,
                "gps_speed_kmh": round(speed, 1),
            })
        df = pd.DataFrame(records)
        r = rng
        # --- inject data-quality anomalies (small, controlled share) ---
        # duplicates
        n_dup = int(n_events * anomaly_rate * 0.3)
        dup_idx = r.choice(len(df), size=n_dup, replace=False)
        df = pd.concat([df, df.iloc[dup_idx]])
        # impossible GPS speeds
        bad_idx = r.choice(len(df), size=int(n_events * anomaly_rate * 0.2), replace=False)
        for i in bad_idx:
            df.loc[i, "gps_speed_kmh"] = float(r.choice([-1, 0, 350, 520, 900]))
        # negative durations
        neg_idx = r.choice(len(df), size=int(n_events * anomaly_rate * 0.1), replace=False)
        for i in neg_idx:
            df.loc[i, "duration_hours"] = -abs(float(r.normal(3, 1)))
        # impossible future timestamps
        fut_idx = r.choice(len(df), size=int(n_events * anomaly_rate * 0.1), replace=False)
        for i in fut_idx:
            df.loc[i, "timestamp"] = self.end + pd.Timedelta(days=400)
        # missing mandatory dst_node
        na_idx = r.choice(len(df), size=int(n_events * anomaly_rate * 0.15), replace=False)
        for i in na_idx:
            df.loc[i, "dst_node"] = ""
        df = df.reset_index(drop=True)
        return df

    # ------------------------------------------------------------------
    def generate_conflict_events(self) -> pd.DataFrame:
        """Structured conflict/geopolitical events (used to compute risk in graph)."""
        rng = self.rng
        nodes = [n["id"] for n in NODE_DEFS]
        kint = {"frankfurt", "european_hub", "suez", "dubai", "indian_ocean"}
        evs = []
        for _ in range(rng.integers(20, 40)):
            node = rng.choice(list(kint))
            ts = self.start + pd.Timedelta(days=int(rng.integers(0, self.n)))
            severity = float(np.clip(rng.gamma(2.0, 1.0), 0.3, 5.0))
            evs.append({
                "event_id": f"CF{rng.integers(100,9999)}",
                "timestamp": ts,
                "location": node,
                "severity": round(severity, 2),
                "event_type": rng.choice(["conflict", "vessel_incident", "blockage", "restriction"]),
            })
        return pd.DataFrame(evs)

    # ------------------------------------------------------------------
    def generate_alerts(self) -> pd.DataFrame:
        """Synthetic NLP event feed (free text) for the event-intelligence layer."""
        rng = self.rng
        templates = {
            "suez": [
                "Severe congestion reported at Suez Canal; transit waiting time up to {n} days.",
                "Shipping company announces {n}% Suez surcharge after new restrictions.",
                "Suez Canal authority reports reduced convoys due to weather {n} knots.",
            ],
            "mumbai": [
                "Mumbai port vessel queuing increased to {n} days amid cargo surge.",
                "Strike threat at Mumbai terminal; operations may halt for {n} days.",
                "Mumbai customs clearance backlog grows to {n} days.",
            ],
            "colombo": [
                "Colombo transshipment hub faces {n}-day berthing delays.",
                "Colombo congestion index elevated; congestion surcharge announced.",
            ],
            "european_hub": [
                "European hub rail strike causes {n} day freight delays.",
            ],
            "customs": [
                "Customs holiday closure delays clearance by {n} days.",
                "Revised documentation requirements add {n} days to customs clearance.",
            ],
            "dubai": [
                "Dubai transshipment diversion increasing; {n} day extra transit.",
            ],
            "indian_ocean": [
                "Severe weather in Indian Ocean; wave height {n} m triggers rerouting.",
            ],
            "cape_of_good_hope": [
                "Cape of Good Hope storms cause {n}-day rerouting delays.",
            ],
        }
        alerts = []
        for node, tpls in templates.items():
            for _ in range(rng.integers(6, 14)):
                tpl = rng.choice(tpls)
                n = int(rng.integers(1, 12))
                date = self.start + pd.Timedelta(days=int(rng.integers(0, self.n)))
                alerts.append({
                    "alert_id": f"AL{rng.integers(1000,99999)}",
                    "date": date,
                    "location": node,
                    "headline": tpl.replace("{n}", str(n)),
                    "source": rng.choice(["port_authority", "news", "carrier_bulletin"]),
                })
        return pd.DataFrame(alerts)


def generate_all(seed: int = 42, years: int = 3) -> dict:
    """Generate the entire synthetic dataset and write it to gold/raw.

    Returns a dict of {name: dataframe} so callers can also keep in memory.
    """
    from core.logging_util import get_logger
    from core import storage
    log = get_logger(__name__)
    storage.ensure_storage_dirs()
    gen = SyntheticDataGenerator(seed=seed, years=years)

    obs = gen.generate_node_observations()
    # Compute derived columns used as targets/features root.
    from core.features.derived import add_is_delayed
    obs = add_is_delayed(obs)
    storage.write_partitioned(obs, "node_observations", ["node_id", "timestamp"])

    raw = gen.generate_raw_events()
    raw.to_parquet(storage.get_settings().abs_data_dir / "raw" / "events.parquet", index=False)

    conflict = gen.generate_conflict_events()
    conflict.to_parquet(storage.get_settings().abs_data_dir / "raw" / "conflict_events.parquet", index=False)

    alerts = gen.generate_alerts()
    alerts.to_parquet(storage.get_settings().abs_data_dir / "raw" / "alerts.parquet", index=False)

    log.info(f"Generated synthetic data: {len(obs)} node observations, "
             f"{len(raw)} raw events, {len(conflict)} conflict events, {len(alerts)} alerts")
    return {"observations": obs, "raw_events": raw, "conflict": conflict, "alerts": alerts}
