"""Fetch real shipping news alerts from free RSS feeds (no API key).

Sources:
  - gCaptain (gcaptain.com/feed) — maritime/shipping news
  - Splash247 (splash247.com/feed) — shipping/logistics news
  - FreightWaves (freightwaves.com/news/rss) — supply chain news

Output:
  - data/raw/alerts.parquet
  - DuckDB table raw_alerts

Schema per row:
  alert_id, date, location (node_id or ''), headline, source

The NLP event_extractor.py then matches headlines to nodes via keyword
aliases and extracts event_type, severity, risk_score per alert.
"""
from __future__ import annotations

import hashlib
import re
import urllib.request
import xml.etree.ElementTree as ET
from datetime import date

import pandas as pd

from backend.core import storage
from backend.core.config import get_settings
from backend.core.logging_util import get_logger

log = get_logger(__name__)

_FEEDS = [
    ("gCaptain", "https://gcaptain.com/feed/"),
    ("Splash247", "https://splash247.com/feed/"),
    ("FreightWaves", "https://www.freightwaves.com/news/rss"),
]

# Keywords that map headlines to our 19 nodes (used by event_extractor too).
# This pre-tagging helps the NLP layer but isn't strictly required.
_NODE_KEYWORDS = {
    "suez": ["suez", "red sea"],
    "bab_el_mandeb": ["bab el-mandeb", "bab el mandeb", "houthi", "yemen"],
    "strait_of_hormuz": ["hormuz", "iran", "persian gulf"],
    "strait_of_malacca": ["malacca", "strait of malacca"],
    "taiwan_strait": ["taiwan strait", "taiwan"],
    "mumbai": ["mumbai", "nhava sheva", "jawaharlal nehru"],
    "colombo": ["colombo"],
    "dubai": ["dubai", "jebel ali"],
    "shanghai": ["shanghai"],
    "singapore": ["singapore"],
    "rotterdam": ["rotterdam", "antwerp", "hamburg"],
    "los_angeles": ["los angeles", "long beach"],
    "new_york": ["new york", "newark"],
    "busan": ["busan"],
    "panama_canal": ["panama canal"],
    "cape_of_good_hope": ["cape of good hope", "cape route"],
    "indian_ocean": ["indian ocean"],
    "english_channel": ["english channel", "dover"],
    "strait_of_gibraltar": ["gibraltar"],
}


def _tag_location(headline: str) -> str:
    low = headline.lower()
    for nid, keywords in _NODE_KEYWORDS.items():
        for kw in keywords:
            if kw in low:
                return nid
    return ""


def _fetch_feed(name: str, url: str) -> list[dict]:
    items = []
    try:
        req = urllib.request.Request(url, headers={
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
        })
        data = urllib.request.urlopen(req, timeout=30).read().decode("utf-8", errors="replace")
        root = ET.fromstring(data)
        for item in root.findall(".//item"):
            title = (item.find("title").text or "").strip()
            pub = (item.find("pubDate").text or "").strip()
            if not title:
                continue
            dt = pd.to_datetime(pub, errors="coerce")
            if pd.isna(dt):
                continue
            aid = hashlib.md5(f"{name}:{title}".encode()).hexdigest()[:12]
            items.append({
                "alert_id": f"RSS-{aid}",
                "date": dt.normalize(),
                "location": _tag_location(title),
                "headline": title,
                "source": name.lower().replace(" ", ""),
            })
    except Exception as e:
        log.warning(f"Feed {name} failed: {e}")
    return items


def fetch_all() -> pd.DataFrame:
    all_items = []
    for name, url in _FEEDS:
        items = _fetch_feed(name, url)
        all_items.extend(items)
        log.info(f"Feed {name}: {len(items)} items")

    df = pd.DataFrame(all_items)
    if df.empty:
        log.warning("No alerts fetched from any feed")
        df = pd.DataFrame(columns=["alert_id", "date", "location", "headline", "source"])
    else:
        df = df.drop_duplicates(subset=["alert_id"]).sort_values("date").reset_index(drop=True)

    s = get_settings()
    storage.ensure_storage_dirs()
    out = s.abs_data_dir / "raw" / "alerts.parquet"
    df.to_parquet(out, index=False)
    log.info(f"Wrote {len(df)} rows -> {out}")

    counts = storage.materialize_warehouse()
    log.info(f"Warehouse: {counts}")
    return df


def main() -> None:
    df = fetch_all()
    print(f"alerts={len(df)} unique_dates={df['date'].nunique()}")
    print(f"tagged={int((df['location'] != '').sum())} / {len(df)}")
    print("\nBy source:")
    print(df["source"].value_counts().to_string())
    print("\nBy location:")
    print(df["location"].value_counts().head(10).to_string())
    print("\nSample headlines:")
    for _, r in df.head(5).iterrows():
        loc = r['location'] or '?'
        print(f"  [{loc}] {r['headline'][:80]}")


if __name__ == "__main__":
    main()
