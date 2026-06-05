"""bench_swarm.py - Measure per-stage swarm latency in demo mode.

Runs the deterministic (DEMO_MODE) agent pipeline end-to-end and prints a
per-stage timing table plus the total. Used to document the <90s SLA claim
with real measured numbers rather than an estimate.

Usage:
    DEMO_MODE=true python bench_swarm.py
"""
import asyncio
import os
import time

os.environ["DEMO_MODE"] = "true"
# Force the deterministic fallback path: clear any real LLM token so
# is_real_llm() is False and we measure pure pipeline latency (no network).
os.environ.pop("GITHUB_TOKEN", None)

import config  # noqa: E402
# config caches the token from .env at import; override the gate so the
# benchmark exercises the deterministic fallback path (no live LLM calls).
config.is_real_llm = lambda: False

import agents  # noqa: E402
from seed_data import SUPPLIERS  # noqa: E402

TRIGGER = {
    "source": "manual",
    "geography": "Mumbai",
    "location": "Mumbai Port",
    "event_type": "cyclone",
    "severity_score": 8,
    "description": "Severe cyclone approaching Mumbai port; shipping suspended.",
}


async def _bench_once(suppliers):
    timings = {}

    t = time.perf_counter()
    monitored = await agents.monitor_agent(dict(TRIGGER))
    timings["Monitor"] = time.perf_counter() - t

    event = {**TRIGGER, **monitored, "event_id": "BENCH-001"}

    t = time.perf_counter()
    forecast = await agents.forecast_agent(event, [], suppliers)
    timings["Forecast"] = time.perf_counter() - t

    t = time.perf_counter()
    risk = await agents.risk_agent(event, [], suppliers)
    timings["Risk"] = time.perf_counter() - t

    t = time.perf_counter()
    action = await agents.action_agent(event, forecast, risk)
    timings["Action"] = time.perf_counter() - t

    t = time.perf_counter()
    await agents.simulation_agent(event, action, [])
    timings["Simulation"] = time.perf_counter() - t

    return timings


async def main():
    suppliers = SUPPLIERS[:10]
    # Warm-up run (module/data caches), then 3 measured runs.
    await _bench_once(suppliers)

    runs = [await _bench_once(suppliers) for _ in range(3)]
    stages = list(runs[0].keys())

    print("\nPer-stage latency (demo mode, severity=8, 10 suppliers)\n")
    print(f"{'Stage':<14}{'avg (ms)':>12}")
    print("-" * 26)
    total = 0.0
    for stage in stages:
        avg = sum(r[stage] for r in runs) / len(runs)
        total += avg
        print(f"{stage:<14}{avg * 1000:>12.1f}")
    print("-" * 26)
    print(f"{'TOTAL':<14}{total * 1000:>12.1f}")
    print(f"\nTotal swarm latency (demo mode): {total:.2f}s  (SLA target: 90s)")


if __name__ == "__main__":
    asyncio.run(main())
