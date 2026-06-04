"""benchmarks.py - Cross-industry benchmark strip.

Section 8 of the Market Differentiation Sprint. The "you vs industry"
metric that competitor platforms don't offer: every client can see how
their portfolio compares to the published industry baseline.

Source data: 10 curated industry .xlsx files in e:/Swarm/dataset/. Each
file has the same column layout as the supplier upload template (see
``EXPECTED_COLUMNS``). Loaded once at module import - in-memory only.

Per-industry metrics:
  - avg_reliability                  (0-100)
  - avg_buffer_days                  (int)
  - avg_sites                        (float)
  - single_source_rate               (share of categories with 1 supplier)
  - geo_concentration_top_zone_pct   (share of suppliers in top zone)

compute_client_vs_industry(client_suppliers, industry) returns per-metric
deltas (client - industry) and a percentile-style verdict band.
"""
from __future__ import annotations

import logging
import os
from collections import Counter
from pathlib import Path
from typing import Optional

logger = logging.getLogger("disruptiq.benchmarks")

# Resolve dataset directory. Default points at the repo's e:/Swarm/dataset
# layout; override with DATASET_PATH env var.
# In Railway, files are in /app, so parents[2] doesn't exist.
# Fall back to looking for dataset in standard locations or via env var.
def _resolve_dataset_dir():
    if os.getenv("DATASET_PATH"):
        return Path(os.getenv("DATASET_PATH"))

    file_path = Path(__file__).resolve()

    # Try: parent/parent/dataset (local dev: .../Swarm Agent/backend/benchmarks.py)
    if (file_path.parents[1] / ".." / "dataset").exists():
        return (file_path.parents[1] / ".." / "dataset").resolve()

    # Try: parent/dataset (Railway: /app/dataset if copied during build)
    if (file_path.parent / "dataset").exists():
        return file_path.parent / "dataset"

    # Try: siblings or common locations
    for parent_count in range(5):
        candidate = file_path.parents[parent_count] / "dataset"
        if candidate.exists():
            return candidate

    # Fallback: return default path (won't crash, will just log warning if datasets not found)
    return file_path.parent / "dataset"

DATASET_DIR = _resolve_dataset_dir()

EXPECTED_COLUMNS = (
    "Supplier Name", "Zone", "Categories",
    "Buffer Stock Days", "Sites", "Reliability (%)", "Proximity Score (1-10)",
)

# Map filename keyword -> canonical industry label that frontend uses.
INDUSTRY_FILE_HINTS: tuple[tuple[str, str], ...] = (
    ("Automotive", "Automotive"),
    ("Electronics", "Electronics"),
    ("Pharma", "Pharma"),
    ("FMCG", "FMCG"),
    ("Aerospace", "Aerospace"),
    ("Renewable", "Renewable Energy"),
    ("Food_Beverage", "Food and Beverage"),
    ("Chemicals", "Chemicals"),
    ("Logistics", "Logistics"),
    ("Medical", "Medical Devices"),
)

# Populated by load_benchmarks(); keyed by canonical industry label.
BENCHMARK_INDUSTRIES: dict[str, dict] = {}


def _infer_industry_from_filename(filename: str) -> Optional[str]:
    for hint, label in INDUSTRY_FILE_HINTS:
        if hint.lower() in filename.lower():
            return label
    return None


def _parse_supplier_row(headers: list[str], row: tuple) -> Optional[dict]:
    """Convert a worksheet row into a supplier dict the metric pipeline
    can consume. Returns None when essential fields are missing."""
    if not row or not row[0]:
        return None
    record = {}
    for idx, header in enumerate(headers):
        if idx >= len(row):
            break
        record[header] = row[idx]
    name = record.get("Supplier Name")
    if not name:
        return None
    return {
        "name": name,
        "zone": record.get("Zone") or "",
        "categories": [c.strip() for c in str(record.get("Categories") or "").split(",") if c.strip()],
        "buffer_stock_days": int(record.get("Buffer Stock Days") or 0),
        "sites": int(record.get("Sites") or 1),
        "reliability": int(record.get("Reliability (%)") or 0),
        "proximity_score": int(record.get("Proximity Score (1-10)") or 5),
    }


def _compute_metrics(suppliers: list[dict]) -> dict:
    """Aggregate metrics for a supplier list. Shared between industry baseline
    (10 .xlsx files at startup) and live client (uploaded suppliers)."""
    if not suppliers:
        return {
            "supplier_count": 0,
            "avg_reliability": 0.0,
            "avg_buffer_days": 0.0,
            "avg_sites": 0.0,
            "single_source_rate": 0.0,
            "geo_concentration_top_zone": None,
            "geo_concentration_top_zone_pct": 0.0,
        }
    total = len(suppliers)
    avg_reliability = round(
        sum(int(s.get("reliability", 0) or 0) for s in suppliers) / total, 1
    )
    avg_buffer = round(
        sum(int(s.get("buffer_stock_days", 0) or 0) for s in suppliers) / total, 1
    )
    avg_sites = round(
        sum(int(s.get("sites", 1) or 1) for s in suppliers) / total, 1
    )

    # Single-source rate: how many categories are served by exactly one supplier
    cat_counts: dict[str, int] = {}
    for s in suppliers:
        for c in (s.get("categories") or []):
            cat = str(c).strip()
            if cat:
                cat_counts[cat] = cat_counts.get(cat, 0) + 1
    if cat_counts:
        single_source_rate = round(
            (sum(1 for v in cat_counts.values() if v == 1) / len(cat_counts)) * 100, 1
        )
    else:
        single_source_rate = 0.0

    # Geographic concentration: share of suppliers in the largest zone
    zone_counter = Counter((s.get("zone") or "Unknown") for s in suppliers)
    top_zone, top_zone_count = zone_counter.most_common(1)[0] if zone_counter else (None, 0)
    geo_concentration_pct = round((top_zone_count / total) * 100, 1) if total else 0.0

    return {
        "supplier_count": total,
        "avg_reliability": avg_reliability,
        "avg_buffer_days": avg_buffer,
        "avg_sites": avg_sites,
        "single_source_rate": single_source_rate,
        "geo_concentration_top_zone": top_zone,
        "geo_concentration_top_zone_pct": geo_concentration_pct,
    }


def load_benchmarks(dataset_dir: Optional[Path] = None) -> dict[str, dict]:
    """Load the 10 industry .xlsx files into BENCHMARK_INDUSTRIES.

    Idempotent: subsequent calls re-read the files (useful when datasets
    are refreshed). Errors on individual files are logged, not raised, so
    a missing or corrupt file does not break startup.
    """
    global BENCHMARK_INDUSTRIES
    try:
        import openpyxl
    except Exception:
        logger.warning("openpyxl unavailable - benchmarks disabled")
        BENCHMARK_INDUSTRIES = {}
        return BENCHMARK_INDUSTRIES

    target = dataset_dir or DATASET_DIR
    if not target.exists():
        logger.warning("benchmarks: dataset dir not found at %s - skipping", target)
        BENCHMARK_INDUSTRIES = {}
        return BENCHMARK_INDUSTRIES

    loaded: dict[str, dict] = {}
    for path in sorted(target.glob("*.xlsx")):
        industry = _infer_industry_from_filename(path.name)
        if not industry:
            continue
        try:
            wb = openpyxl.load_workbook(path, data_only=True, read_only=True)
            ws = wb.active
            rows = list(ws.iter_rows(values_only=True))
            if not rows:
                continue
            headers = [str(c) if c is not None else "" for c in rows[0]]
            suppliers = [s for s in (_parse_supplier_row(headers, r) for r in rows[1:]) if s]
            metrics = _compute_metrics(suppliers)
            metrics["industry"] = industry
            metrics["source_file"] = path.name
            loaded[industry] = metrics
            wb.close()
        except Exception as exc:
            logger.warning("benchmarks: failed to load %s: %s", path.name, exc)

    BENCHMARK_INDUSTRIES = loaded
    logger.info("benchmarks: loaded %d industry baselines from %s", len(loaded), target)
    return BENCHMARK_INDUSTRIES


def _verdict(delta: float, higher_is_better: bool) -> str:
    """Categorize how the client compares to the industry on one metric."""
    if abs(delta) < 0.01:
        return "in_line"
    if (delta > 0 and higher_is_better) or (delta < 0 and not higher_is_better):
        return "better"
    return "worse"


def compute_client_vs_industry(
    client_suppliers: list[dict],
    industry: str,
) -> Optional[dict]:
    """Compare a client's supplier portfolio to the industry baseline.

    Returns None when the requested industry has no baseline (or hasn't been
    loaded). Otherwise returns the client's metrics + per-metric deltas + a
    verdict band per metric.
    """
    baseline = BENCHMARK_INDUSTRIES.get(industry)
    if not baseline:
        return None
    client = _compute_metrics(client_suppliers or [])

    return {
        "industry": industry,
        "baseline_source": baseline.get("source_file"),
        "baseline_supplier_count": baseline.get("supplier_count", 0),
        "client_supplier_count": client["supplier_count"],
        "metrics": {
            "avg_reliability": {
                "client": client["avg_reliability"],
                "industry": baseline["avg_reliability"],
                "delta": round(client["avg_reliability"] - baseline["avg_reliability"], 1),
                "higher_is_better": True,
                "verdict": _verdict(client["avg_reliability"] - baseline["avg_reliability"], True),
            },
            "avg_buffer_days": {
                "client": client["avg_buffer_days"],
                "industry": baseline["avg_buffer_days"],
                "delta": round(client["avg_buffer_days"] - baseline["avg_buffer_days"], 1),
                "higher_is_better": True,
                "verdict": _verdict(client["avg_buffer_days"] - baseline["avg_buffer_days"], True),
            },
            "avg_sites": {
                "client": client["avg_sites"],
                "industry": baseline["avg_sites"],
                "delta": round(client["avg_sites"] - baseline["avg_sites"], 1),
                "higher_is_better": True,
                "verdict": _verdict(client["avg_sites"] - baseline["avg_sites"], True),
            },
            "single_source_rate": {
                "client": client["single_source_rate"],
                "industry": baseline["single_source_rate"],
                "delta": round(client["single_source_rate"] - baseline["single_source_rate"], 1),
                "higher_is_better": False,
                "verdict": _verdict(client["single_source_rate"] - baseline["single_source_rate"], False),
            },
            "geo_concentration_pct": {
                "client": client["geo_concentration_top_zone_pct"],
                "industry": baseline["geo_concentration_top_zone_pct"],
                "delta": round(client["geo_concentration_top_zone_pct"] - baseline["geo_concentration_top_zone_pct"], 1),
                "higher_is_better": False,
                "verdict": _verdict(client["geo_concentration_top_zone_pct"] - baseline["geo_concentration_top_zone_pct"], False),
            },
        },
        "client_top_zone": client["geo_concentration_top_zone"],
        "industry_top_zone": baseline["geo_concentration_top_zone"],
    }


def list_available_industries() -> list[str]:
    return sorted(BENCHMARK_INDUSTRIES.keys())
