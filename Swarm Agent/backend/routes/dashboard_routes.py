"""
routes/dashboard_routes.py - dashboard widget endpoints.

Includes /api/demo-scenarios, /api/news/latest, /api/weather/current,
/api/supply-chain-map, /api/resilience-score, /api/data-quality,
/api/dependency-heatmap, /api/scenarios, /api/search.

Shared state and helpers remain in main.py and are imported lazily inside
each handler to avoid a circular import.
"""

import logging
import math
import secrets
from collections import Counter, defaultdict

from fastapi import APIRouter, Depends, HTTPException, Query

import agents
import auth
import benchmarks
import briefing_history
import storage
import tier2_inference
from models import EventTrigger, ScenarioCreate

logger = logging.getLogger("disruptiq.routes.dashboard")

dashboard_router = APIRouter(tags=["dashboard"])


@dashboard_router.get("/api/demo-scenarios")
async def demo_scenarios(current_user: dict = Depends(auth.get_optional_user)):
    """Demo scenarios only shown to seed clients (demo). Real clients get empty list."""
    from main import SEED_CLIENT_IDS, DEMO_SCENARIOS
    client_id = current_user.get("client_id", "demo")
    if client_id not in SEED_CLIENT_IDS:
        return []
    return DEMO_SCENARIOS


@dashboard_router.post("/api/demo-scenarios/{scenario_id}/trigger")
async def trigger_demo_scenario(scenario_id: str, current_user: dict = Depends(auth.get_optional_user)):
    """Trigger a demo scenario for the authenticated user's client."""
    from main import DEMO_SCENARIOS, run_swarm
    client_id = current_user.get("client_id", "demo")
    scenario = next((s for s in DEMO_SCENARIOS if s.get("id") == scenario_id), None)
    if not scenario:
        raise HTTPException(status_code=404, detail="Scenario not found")

    trigger = EventTrigger(
        description=scenario.get("description", "Demo scenario"),
        location=scenario.get("location", "Test"),
        source=scenario.get("source", "Demo"),
        type=scenario.get("type", "Test Event"),
    )
    return await run_swarm(trigger, client_id=client_id)


@dashboard_router.get("/api/news/latest")
async def latest_news(current_user: dict = Depends(auth.get_optional_user)):
    """Get latest news and weather alerts. Filtered by client's supplier zones."""
    from main import (clients_db, SEED_CLIENT_IDS, INDUSTRY_NEWS_KEYWORDS,
                      CITY_TO_ZONE, _client_zones, _recent_alerts, _now_utc)
    client_id = current_user.get("client_id", "demo")
    client_zones = _client_zones(client_id)

    industry = clients_db.get(client_id, {}).get("industry", "")
    kws = [k.lower() for k in INDUSTRY_NEWS_KEYWORDS.get(industry, [])]
    is_seed_client = client_id in SEED_CLIENT_IDS

    def _alert_relevant(alert):
        loc = alert.get("location")
        text = (alert.get("title", "") + " " + alert.get("description", "")).lower()
        if client_zones:
            return (not loc) or (CITY_TO_ZONE.get(loc, loc) in client_zones)
        if kws:
            return any(k in text for k in kws)
        return is_seed_client

    filtered = [a for a in _recent_alerts if _alert_relevant(a)]
    return {
        "alerts": filtered[:20],
        "total": len(filtered),
        "last_updated_utc": _now_utc(),
        "filtered_by_zones": sorted(client_zones) if client_zones else None,
    }


@dashboard_router.get("/api/weather/current")
async def weather_current(current_user: dict = Depends(auth.get_optional_user)):
    """Get current weather snapshot for monitored cities."""
    from main import SEED_CLIENT_IDS, _client_zones, _city_weather, _now_utc
    client_id = current_user.get("client_id", "demo")
    client_zones = _client_zones(client_id)
    is_seed_client = client_id in SEED_CLIENT_IDS
    all_cities = list(_city_weather.values())

    if client_zones:
        relevant = [c for c in all_cities if c.get("name") in client_zones]
        other    = [c for c in all_cities if c.get("name") not in client_zones]
        for c in relevant:
            c["relevant_to_client"] = True
        for c in other:
            c["relevant_to_client"] = False
        relevant.sort(key=lambda c: -c.get("severity_score", 0))
        other.sort(key=lambda c: -c.get("severity_score", 0))
        cities = relevant + other
    elif is_seed_client:
        for c in all_cities:
            c["relevant_to_client"] = True
        cities = sorted(all_cities, key=lambda c: -c.get("severity_score", 0))
    else:
        cities = []

    return {
        "cities": cities,
        "last_updated_utc": _now_utc(),
        "client_zones": sorted(client_zones) if client_zones else None,
    }


@dashboard_router.get("/api/supply-chain-map")
async def supply_chain_map(current_user: dict = Depends(auth.require_auth)):
    """Feature 1 - Digital Twin: supplier/port/HQ nodes, routes, and live status."""
    from main import (clients_db, SEED_CLIENT_IDS,
                      LOGISTICS_HUBS, ZONE_COORDINATES,
                      _resolve_suppliers, _mark_onboarding_step, _normalize_zone,
                      _geocode_zone, _geocode_cache, _now_utc)
    _CENTRAL_INDIA = {"lat": 22.0, "lon": 79.0}

    def _zone_coords(zone: str) -> dict:
        return _geocode_cache.get(zone) or ZONE_COORDINATES.get(zone, _CENTRAL_INDIA)

    def _get_zone_overlap(geography: str) -> set:
        if not geography:
            return set()
        geo_lower = geography.lower()
        matched = {z for z in ZONE_COORDINATES if z.lower() in geo_lower or geo_lower in z.lower()}
        return matched if matched else {geography}

    def _get_active_events(client_id: str) -> list:
        try:
            return [e for e in storage.list_events()
                    if e.get("client_id") == client_id and e.get("status") != "resolved"]
        except Exception:
            return []

    client_id = current_user["client_id"]
    _mark_onboarding_step(client_id, "map_viewed", True)
    suppliers = _resolve_suppliers(client_id)
    active_events = _get_active_events(client_id)
    client_record = clients_db.get(client_id, {})

    disrupted_zones = set()
    for ev in active_events:
        disrupted_zones |= _get_zone_overlap(ev.get("geography", ""))

    def events_for_zone(zone: str) -> list:
        return [ev for ev in active_events if zone in _get_zone_overlap(ev.get("geography", ""))]

    by_zone = defaultdict(list)
    for sup in suppliers:
        by_zone[sup["zone"]].append(sup)

    for zone in list(by_zone.keys()):
        coords = ZONE_COORDINATES.get(zone, _CENTRAL_INDIA)
        if coords == _CENTRAL_INDIA and zone not in ZONE_COORDINATES:
            geocoded = await _geocode_zone(zone)
            _geocode_cache[zone] = geocoded

    nodes = []
    for zone, group in by_zone.items():
        base = _geocode_cache.get(zone) or ZONE_COORDINATES.get(zone, _CENTRAL_INDIA)
        zone_events = events_for_zone(zone)
        zone_disrupted = zone in disrupted_zones
        n = len(group)
        for idx, sup in enumerate(group):
            if n == 1:
                lat, lon = base["lat"], base["lon"]
            else:
                angle = (2 * math.pi * idx) / n
                lat = base["lat"] + 0.55 * math.cos(angle)
                lon = base["lon"] + 0.55 * math.sin(angle)
            nodes.append({
                "id": sup["id"],
                "name": sup["name"],
                "type": "supplier",
                "zone": zone,
                "lat": round(lat, 4),
                "lon": round(lon, 4),
                "reliability": sup["reliability"],
                "buffer_stock_days": sup["buffer_stock_days"],
                "sites": sup["sites"],
                "categories": sup["categories"],
                "criticality": ("critical" if sup["buffer_stock_days"] <= 3
                                else "high" if sup["proximity_score"] >= 7
                                else "medium"),
                "status": "disrupted" if zone_disrupted else "active",
                "active_events": zone_events,
            })

    port_nodes = []
    for hub in LOGISTICS_HUBS:
        hub_disrupted = any(z in disrupted_zones for z in _get_zone_overlap(hub["name"].split()[0]))
        port_nodes.append({
            "id": hub["id"], "name": hub["name"], "type": "port",
            "zone": hub["name"], "lat": hub["lat"], "lon": hub["lon"],
            "criticality": "critical",
            "status": "disrupted" if hub_disrupted else "active",
            "active_events": [],
        })

    routes = []
    for node in nodes:
        nearest = min(LOGISTICS_HUBS,
                      key=lambda h: math.hypot(h["lat"] - node["lat"], h["lon"] - node["lon"]))
        routes.append({
            "id": f"{node['id']}-{nearest['id']}",
            "from": node["id"], "from_name": node["name"],
            "to": nearest["id"], "to_name": nearest["name"],
            "status": "at_risk" if node["status"] == "disrupted" else "normal",
        })

    hq_node = None
    hq_routes = []
    raw_hq = client_record.get("headquarters_zone") or client_record.get("headquarters_zone_raw") or ""
    hq_zone = _normalize_zone(raw_hq) if raw_hq else None
    if not hq_zone and client_id in SEED_CLIENT_IDS and suppliers:
        zone_counts = Counter(s.get("zone", "") for s in suppliers if s.get("zone"))
        hq_zone = zone_counts.most_common(1)[0][0] if zone_counts else None
    if hq_zone:
        hq_coords = _geocode_cache.get(hq_zone) or ZONE_COORDINATES.get(hq_zone, {"lat": 22.0, "lon": 79.0})
        hq_node = {
            "id": f"HQ-{client_id}",
            "name": f"{client_record.get('company_name', 'Your Company')} HQ",
            "type": "hq",
            "zone": hq_zone,
            "lat": round(hq_coords["lat"], 4),
            "lon": round(hq_coords["lon"], 4),
            "criticality": "critical",
            "status": "disrupted" if hq_zone in disrupted_zones else "active",
            "active_events": events_for_zone(hq_zone),
            "company_name": client_record.get("company_name", "Your Company"),
        }
        for node in nodes:
            hq_routes.append({
                "id": f"{node['id']}-HQ",
                "from": node["id"], "from_name": node["name"],
                "to": hq_node["id"], "to_name": hq_node["name"],
                "kind": "supplier_to_hq",
                "status": "at_risk" if node["status"] == "disrupted" else "normal",
            })

    all_nodes = nodes + port_nodes + ([hq_node] if hq_node else [])
    all_routes = routes + hq_routes
    disrupted_count = sum(1 for n in nodes if n["status"] == "disrupted")
    at_risk_routes = sum(1 for r in all_routes if r["status"] == "at_risk")
    return {
        "client_id": client_id,
        "headquarters_zone": hq_zone,
        "nodes": all_nodes,
        "routes": all_routes,
        "summary": {
            "total_nodes": len(all_nodes),
            "supplier_nodes": len(nodes),
            "port_nodes": len(port_nodes),
            "hq_nodes": 1 if hq_node else 0,
            "disrupted_nodes": disrupted_count,
            "total_routes": len(all_routes),
            "at_risk_routes": at_risk_routes,
            "active_disruptions": len(active_events),
            "overall_health": ("critical" if disrupted_count > 2
                               else "warning" if disrupted_count > 0
                               else "healthy"),
        },
        "last_updated_utc": _now_utc(),
    }


@dashboard_router.get("/api/resilience-score")
async def resilience_score(current_user: dict = Depends(auth.require_auth)):
    """Feature 2 - proactive 0-100 supply chain resilience score."""
    from main import _resolve_suppliers, _mark_onboarding_step
    client_id = current_user["client_id"]
    _mark_onboarding_step(client_id, "score_checked", True)
    return agents.resilience_score_agent(client_id, _resolve_suppliers(client_id))


@dashboard_router.get("/api/disruption-risk")
async def disruption_risk_briefing(current_user: dict = Depends(auth.require_auth)):
    """Daily disruption-risk briefing — 0-100 score derived from the client's
    zones, news pulse, weather snapshot, and supplier reliability. Returns
    ``score=0`` and a "no suppliers" message for clients who haven't uploaded
    yet (no seed-data leak)."""
    from main import _resolve_suppliers
    client_id = current_user["client_id"]
    suppliers = _resolve_suppliers(client_id)
    return await agents.predict_disruption_risk(client_id, suppliers)


@dashboard_router.get("/api/benchmarks/industry")
async def industry_benchmark(current_user: dict = Depends(auth.require_auth)):
    """Section 8 Sprint: cross-industry benchmark strip.

    Returns the client's metrics + the matching industry baseline + a
    per-metric delta. The industry label is taken from the client's
    registered industry; if unknown / unsupported, returns a clear message
    instead of a confusing 404.

    Empty-state: when the caller has no suppliers we still return the
    industry baseline so the user sees what the bar to clear looks like.
    """
    from main import clients_db, _resolve_suppliers, _now_utc

    client_id = current_user["client_id"]
    client_profile = clients_db.get(client_id) or {}
    industry = client_profile.get("industry") or ""
    client_suppliers = _resolve_suppliers(client_id)

    available = benchmarks.list_available_industries()
    comparison = benchmarks.compute_client_vs_industry(client_suppliers, industry)

    if comparison is None:
        return {
            "client_id": client_id,
            "industry": industry or None,
            "available_industries": available,
            "comparison": None,
            "message": (
                f"No benchmark baseline available for industry '{industry}'."
                if industry
                else "Set your company industry to see how you compare to peers."
            ),
            "last_updated_utc": _now_utc(),
        }

    return {
        "client_id": client_id,
        "industry": industry,
        "available_industries": available,
        "comparison": comparison,
        "last_updated_utc": _now_utc(),
    }


@dashboard_router.get("/api/briefing/history")
async def briefing_history_route(
    days: int = 30,
    current_user: dict = Depends(auth.require_auth),
):
    """Section 7 Sprint: return the client's daily disruption-risk briefing
    history (up to `days` records, newest first). Clients with no history
    yet get an empty list - the dashboard renders an empty-state hint.
    """
    from main import _now_utc
    client_id = current_user["client_id"]
    records = briefing_history.get_briefing_history(client_id, days=max(1, min(days, 90)))
    return {
        "client_id": client_id,
        "history": records,
        "count": len(records),
        "last_updated_utc": _now_utc(),
    }


@dashboard_router.get("/api/supply-chain/tier2")
async def tier2_visibility(current_user: dict = Depends(auth.require_auth)):
    """Section 3 Sprint: probabilistic Tier-2 dependency inference.

    Returns inferred Tier-2 categories and single-points-of-failure derived
    from the client's own uploaded supplier categories. All results are
    clearly marked as ``is_estimated`` so the UI never claims surveyed-supplier
    accuracy.

    Empty state: returns empty arrays + a help message when the client has no
    suppliers. Identical behaviour for demo and real onboarded clients.
    """
    from main import _resolve_suppliers, _now_utc
    client_id = current_user["client_id"]
    suppliers = _resolve_suppliers(client_id)
    if not suppliers:
        return {
            "client_id": client_id,
            "tier1_count": 0,
            "tier2_inferred_count": 0,
            "tier2_nodes": [],
            "single_points_of_failure": [],
            "message": "Upload Tier-1 suppliers to infer Tier-2 dependencies.",
            "disclaimer": "Tier-2 data is probabilistically inferred, not surveyed.",
            "last_updated_utc": _now_utc(),
        }

    tier2_nodes = tier2_inference.infer_tier2_dependencies(suppliers)
    spofs = tier2_inference.identify_tier2_single_points_of_failure(
        tier2_nodes, tier1_count=len(suppliers),
    )
    return {
        "client_id": client_id,
        "tier1_count": len(suppliers),
        "tier2_inferred_count": len(tier2_nodes),
        "tier2_nodes": tier2_nodes,
        "single_points_of_failure": spofs,
        "disclaimer": (
            "Tier-2 dependencies are probabilistically inferred from industry "
            "knowledge graphs, not supplier surveys. Confidence scores indicate "
            "inference reliability."
        ),
        "last_updated_utc": _now_utc(),
    }


@dashboard_router.get("/api/data-quality")
async def data_quality(current_user: dict = Depends(auth.require_auth)):
    """Feature 3 - data source quality + overall confidence assessment."""
    from main import (clients_db, SEED_CLIENT_IDS, INDUSTRY_NEWS_KEYWORDS,
                      CITY_TO_ZONE, _client_zones, _recent_alerts, _city_weather,
                      _resolve_suppliers)
    client_id = current_user["client_id"]
    client_zones = _client_zones(client_id)
    industry = clients_db.get(client_id, {}).get("industry", "")
    kws = [k.lower() for k in INDUSTRY_NEWS_KEYWORDS.get(industry, [])]

    def _alert_in_scope(a):
        loc = a.get("location")
        text = (a.get("title", "") + " " + a.get("description", "")).lower()
        if client_zones:
            return (not loc) or (CITY_TO_ZONE.get(loc, loc) in client_zones)
        if kws:
            return any(k in text for k in kws)
        return client_id in SEED_CLIENT_IDS

    filtered_alerts = [a for a in _recent_alerts if _alert_in_scope(a)]
    filtered_cities = (
        [c for c in _city_weather.values() if c.get("name") in client_zones]
        if client_zones else
        (list(_city_weather.values()) if client_id in SEED_CLIENT_IDS else [])
    )

    return agents.data_quality_agent(
        news_alerts=filtered_alerts,
        weather_cities=filtered_cities,
        suppliers=_resolve_suppliers(client_id),
    )


@dashboard_router.get("/api/dependency-heatmap")
async def dependency_heatmap(current_user: dict = Depends(auth.require_auth)):
    """Feature 6 - category x zone supplier dependency / concentration map."""
    from main import _resolve_suppliers
    client_id = current_user["client_id"]
    return agents.supplier_dependency_agent(client_id, _resolve_suppliers(client_id))


@dashboard_router.get("/api/scenarios")
async def list_scenarios(current_user: dict = Depends(auth.require_auth)):
    """List custom + template scenarios."""
    from main import custom_scenarios_db, SEED_CLIENT_IDS, SCENARIO_TEMPLATES
    client_id = current_user["client_id"]
    custom = custom_scenarios_db.get(client_id, [])
    templates = SCENARIO_TEMPLATES if client_id in SEED_CLIENT_IDS else []
    return {"custom": custom, "templates": templates}


@dashboard_router.post("/api/scenarios")
async def create_scenario(body: ScenarioCreate, current_user: dict = Depends(auth.require_auth)):
    """Create and save a custom scenario."""
    from main import custom_scenarios_db, _now_utc
    client_id = current_user["client_id"]
    custom_list = custom_scenarios_db.setdefault(client_id, [])

    if len(custom_list) >= 20:
        raise HTTPException(status_code=400, detail="Scenario limit reached (max 20)")

    scenario = {
        "id": f"scen_{secrets.token_hex(6)}",
        "client_id": client_id,
        "name": body.name[:100],
        "description": body.description[:500],
        "location": body.location,
        "type": body.type,
        "severity": max(1, min(10, body.severity)),
        "tags": body.tags[:10],
        "created_at": _now_utc(),
    }
    custom_list.append(scenario)
    storage.write_audit(f"scen_{secrets.token_hex(6)}", "ScenarioManager", "scenario_created",
                       f"name={scenario['name']}", f"severity={scenario['severity']}", client_id=client_id)
    return scenario


@dashboard_router.delete("/api/scenarios/{scenario_id}")
async def delete_scenario(scenario_id: str, current_user: dict = Depends(auth.require_auth)):
    """Delete a custom scenario."""
    from main import custom_scenarios_db
    if scenario_id.startswith("tpl_"):
        raise HTTPException(status_code=404, detail="Cannot delete template scenarios")

    client_id = current_user["client_id"]
    custom_list = custom_scenarios_db.get(client_id, [])
    for i, scenario in enumerate(custom_list):
        if scenario.get("id") == scenario_id:
            custom_list.pop(i)
            storage.write_audit(scenario_id, "ScenarioManager", "scenario_deleted",
                               f"name={scenario.get('name')}", "", client_id=client_id)
            return {"success": True}

    raise HTTPException(status_code=404, detail="Scenario not found")


@dashboard_router.get("/api/threat-intelligence")
async def predicted_disruptions(current_user: dict = Depends(auth.require_auth)):
    """Threat Intelligence: synthesise live signals (weather, news, geo-political risk,
    Tier-2 SPOFs, supply pressure) into ranked predicted disruption scenarios specific
    to this client's supplier network."""
    from main import (clients_db, SEED_CLIENT_IDS, INDUSTRY_NEWS_KEYWORDS,
                      CITY_TO_ZONE, _client_zones, _recent_alerts, _city_weather,
                      _resolve_suppliers, _now_utc)

    client_id = current_user["client_id"]
    suppliers  = _resolve_suppliers(client_id)

    if not suppliers:
        return {
            "predictions": [],
            "count": 0,
            "signal_sources": {},
            "message": "Upload your suppliers to activate Threat Intelligence.",
            "last_updated_utc": _now_utc(),
        }

    industry     = clients_db.get(client_id, {}).get("industry", "")
    client_zones = _client_zones(client_id)
    kws          = [k.lower() for k in INDUSTRY_NEWS_KEYWORDS.get(industry, [])]

    def _alert_relevant(alert):
        loc  = alert.get("location") or ""
        text = (alert.get("title", "") + " " + alert.get("description", "")).lower()
        if client_zones:
            return (not loc) or (CITY_TO_ZONE.get(loc, loc) in client_zones) or (loc in client_zones)
        if kws:
            return any(k in text for k in kws)
        return client_id in SEED_CLIENT_IDS

    filtered_alerts = [a for a in _recent_alerts if _alert_relevant(a)]
    city_weather    = dict(_city_weather)

    predictions = _generate_predicted_disruptions(
        suppliers=suppliers,
        alerts=filtered_alerts,
        city_weather=city_weather,
        industry=industry,
    )

    type_counts: dict[str, int] = {}
    for p in predictions:
        st = p["signal_type"]
        type_counts[st] = type_counts.get(st, 0) + 1

    return {
        "predictions": predictions[:12],
        "count": len(predictions),
        "signal_sources": type_counts,
        "last_updated_utc": _now_utc(),
    }


# ── Threat Intelligence helpers ───────────────────────────────────────────────

_ZONE_RISK_INDEX: dict[str, float] = {
    "Mumbai": 0.30, "Delhi": 0.35, "Chennai": 0.28, "Bengaluru": 0.25,
    "Kolkata": 0.40, "Pune": 0.25, "Hyderabad": 0.28, "Ahmedabad": 0.30,
    "Kochi": 0.22, "North India": 0.35, "South India": 0.28,
    "East India": 0.42, "West India": 0.30, "India": 0.30,
    "Bangladesh": 0.55, "Sri Lanka": 0.50, "Pakistan": 0.72,
    "Bangkok": 0.42, "Kuala Lumpur": 0.28, "Jakarta": 0.45,
    "Singapore": 0.08, "Vietnam": 0.35, "Philippines": 0.52,
    "Ho Chi Minh City": 0.35, "Hanoi": 0.35, "Myanmar": 0.78,
    "Colombo": 0.50, "Dhaka": 0.55,
    "Tokyo": 0.12, "Japan": 0.12, "Osaka": 0.12,
    "Seoul": 0.32, "South Korea": 0.32, "Busan": 0.32,
    "Shanghai": 0.52, "Beijing": 0.55, "Shenzhen": 0.52,
    "Guangzhou": 0.52, "China": 0.55,
    "Taipei": 0.72, "Taiwan": 0.72, "Hong Kong": 0.55,
    "Sydney": 0.10, "Melbourne": 0.10, "Brisbane": 0.10, "Australia": 0.10,
    "Dubai": 0.28, "Abu Dhabi": 0.28, "Gulf States": 0.45,
    "Jeddah": 0.38, "Saudi Arabia": 0.40,
    "Iran": 0.82, "Iraq": 0.88, "Israel": 0.78, "Yemen": 0.92,
    "Rotterdam": 0.10, "Amsterdam": 0.10, "Frankfurt": 0.10,
    "Hamburg": 0.10, "Germany": 0.10,
    "London": 0.14, "UK": 0.14,
    "Paris": 0.16, "France": 0.16,
    "Warsaw": 0.28, "Poland": 0.28,
    "Ukraine": 0.95, "Russia": 0.92,
    "Turkey": 0.58, "Istanbul": 0.58,
    "Chicago": 0.20, "New York": 0.20, "Los Angeles": 0.20,
    "Houston": 0.22, "USA": 0.20,
    "Mexico City": 0.55, "Mexico": 0.55,
    "Sao Paulo": 0.50, "Brazil": 0.50,
    "Buenos Aires": 0.60, "Argentina": 0.60,
    "South Africa": 0.52, "Johannesburg": 0.55,
    "Nigeria": 0.65, "Lagos": 0.65,
    "Egypt": 0.55, "Cairo": 0.55,
}

_WEATHER_EVENT_MAP: dict[str, tuple[str, int]] = {
    "Thunderstorm": ("Cyclone", 2), "Heavy Thunderstorm": ("Cyclone", 3),
    "Cyclone": ("Cyclone", 4), "Tropical Cyclone": ("Cyclone", 4),
    "Flood": ("Flooding", 3), "Heavy Rain": ("Flooding", 1),
    "Heavy Precipitation": ("Flooding", 2),
    "Violent Snowstorm": ("Custom", 3), "Blizzard": ("Custom", 3),
    "Heavy Snow": ("Custom", 2), "Heatwave": ("Custom", 1),
    "Dust Storm": ("Custom", 2), "Dense Fog": ("Custom", 1),
    "Tornado": ("Cyclone", 4),
}

_SIGNAL_PRIORITY = {
    "live_news": 5, "weather_alert": 4, "geo_political": 3,
    "category_risk": 2, "supply_pressure": 1,
}


def _generate_predicted_disruptions(
    suppliers: list[dict],
    alerts: list[dict],
    city_weather: dict,
    industry: str,
) -> list[dict]:
    """Synthesise 5 signal types into a ranked list of predicted disruption scenarios."""
    import secrets as _sec
    predictions: list[dict] = []
    seen: set[str] = set()

    def _uid() -> str:
        return f"pred_{_sec.token_hex(5)}"

    def _key(prefix: str, val: str) -> str:
        return f"{prefix}::{val[:32].lower()}"

    # ── Signal 1: Live weather ────────────────────────────────────────────────
    client_zones = {s.get("zone", "") for s in suppliers if s.get("zone")}
    for zone in client_zones:
        wx = city_weather.get(zone)
        if not wx:
            continue
        raw_sev    = wx.get("severity_score", 0)
        condition  = wx.get("weather_description", "")
        alert_stat = wx.get("alert_status", "clear")
        if raw_sev < 5 and alert_stat == "clear":
            continue

        zone_sups = [s for s in suppliers if s.get("zone") == zone]
        low_buf   = [s for s in zone_sups if (s.get("buffer_stock_days") or 30) < 15]
        evt_type, bonus = _WEATHER_EVENT_MAP.get(condition, ("Custom", 0))
        severity  = min(10, raw_sev + bonus + (1 if len(low_buf) >= 2 else 0))

        key = _key("wx", zone)
        if key in seen:
            continue
        seen.add(key)

        drivers = [f"Live forecast: {condition} in {zone}",
                   f"{len(zone_sups)} supplier(s) operating in affected zone"]
        if low_buf:
            drivers.append(f"{len(low_buf)} supplier(s) with <15 days buffer — acute stockout exposure")
        if wx.get("wind_kmh", 0) >= 60:
            drivers.append(f"Wind {wx['wind_kmh']} km/h — logistics disruption risk")
        if wx.get("precip_mm_24h", 0) >= 30:
            drivers.append(f"Precipitation {wx['precip_mm_24h']} mm/24h — flood / access risk")

        predictions.append({
            "id": _uid(),
            "name": f"{condition or 'Severe Weather'} — {zone}",
            "description": (
                f"{condition} conditions forecast for {zone}, where {len(zone_sups)} of your "
                f"suppliers operate. {len(low_buf)} supplier(s) carry <15 days buffer, "
                "creating immediate stockout exposure if logistics are disrupted."
            ),
            "type": evt_type,
            "location": zone,
            "severity": severity,
            "signal_type": "weather_alert",
            "signal_label": "Weather Signal",
            "signal_source": f"{condition} · {wx.get('wind_kmh', '?')} km/h · {wx.get('precip_mm_24h', '?')} mm rain",
            "confidence": round(min(0.93, 0.55 + raw_sev * 0.042), 2),
            "affected_suppliers": [s["name"] for s in zone_sups],
            "drivers": drivers[:4],
            "tags": ["weather", zone.lower().replace(" ", "-"), evt_type.lower()],
            "is_predicted": True,
        })

    # ── Signal 2: Live news alerts ────────────────────────────────────────────
    for alert in alerts[:20]:
        alert_sev  = alert.get("severity", 0)
        alert_zone = alert.get("location") or ""
        if alert_sev < 5:
            continue

        zone_sups = ([s for s in suppliers if s.get("zone") == alert_zone]
                     if alert_zone else [])
        if not zone_sups and alert_zone:
            zone_sups = [s for s in suppliers
                         if alert_zone.lower() in (s.get("zone") or "").lower()
                         or (s.get("zone") or "").lower() in alert_zone.lower()]
        display_sups = zone_sups if zone_sups else suppliers[:4]

        key = _key("news", alert.get("title", "n")[:28])
        if key in seen:
            continue
        seen.add(key)

        drivers = [f"Verified source: {alert.get('source', 'News feed')}",
                   f"Disruption severity index: {alert_sev}/10"]
        if zone_sups:
            drivers.append(f"{len(zone_sups)} supplier(s) in reported zone")
        else:
            drivers.append("Industry-wide signal — potential broad impact")
        if alert.get("alert_type") == "Open-Meteo":
            drivers.append("Corroborated by meteorological data")

        raw_type = alert.get("alert_type", "Custom")
        evt_type = "Custom" if raw_type in ("NewsAPI", "Open-Meteo") else raw_type

        predictions.append({
            "id": _uid(),
            "name": alert.get("title", "Market Disruption Signal")[:80],
            "description": (
                (alert.get("description") or "")[:220]
                + (f" Potentially affecting {len(display_sups)} supplier(s) in your network."
                   if display_sups else "")
            ),
            "type": evt_type,
            "location": alert_zone or "Multiple Zones",
            "severity": alert_sev,
            "signal_type": "live_news",
            "signal_label": "Live News",
            "signal_source": alert.get("source", "News Feed"),
            "confidence": round(min(0.88, 0.44 + alert_sev * 0.044), 2),
            "affected_suppliers": [s["name"] for s in display_sups[:6]],
            "drivers": drivers[:4],
            "tags": ["live-signal", (alert_zone or "global").lower().replace(" ", "-")],
            "is_predicted": True,
        })

    # ── Signal 3: Geo-political zone risk ────────────────────────────────────
    zone_map: dict[str, list[dict]] = {}
    for s in suppliers:
        z = s.get("zone", "")
        if z:
            zone_map.setdefault(z, []).append(s)

    for zone, zone_sups in zone_map.items():
        risk = _ZONE_RISK_INDEX.get(zone, 0.25)
        if risk < 0.48:
            continue
        severity = min(10, max(5, round(risk * 10)))
        key = _key("geo", zone)
        if key in seen:
            continue
        seen.add(key)

        risk_pct  = round(risk * 100)
        risk_desc = ("Critical" if risk >= 0.75 else "Elevated" if risk >= 0.55 else "Moderate")

        predictions.append({
            "id": _uid(),
            "name": f"Geopolitical Exposure — {zone}",
            "description": (
                f"{zone} carries a {risk_desc} geopolitical instability index ({risk_pct}%). "
                f"{len(zone_sups)} of your suppliers are concentrated here. "
                "Trade-policy shifts, sanctions, or civil instability could disrupt "
                "operations with minimal warning."
            ),
            "type": "Geopolitical",
            "location": zone,
            "severity": severity,
            "signal_type": "geo_political",
            "signal_label": "Geo-Political",
            "signal_source": f"Zone instability index: {risk_pct}%",
            "confidence": round(risk * 0.88, 2),
            "affected_suppliers": [s["name"] for s in zone_sups],
            "drivers": [
                f"Zone instability index: {risk_pct}% ({risk_desc})",
                f"{len(zone_sups)} supplier(s) concentrated in {zone}",
                "Sanctions / trade-policy disruption risk",
                "Sudden border or port closure risk",
            ],
            "tags": ["geopolitical", zone.lower().replace(" ", "-"), "concentration"],
            "is_predicted": True,
        })

    # ── Signal 4: Tier-2 structural SPOFs ────────────────────────────────────
    tier2_nodes = tier2_inference.infer_tier2_dependencies(suppliers)
    spofs       = tier2_inference.identify_tier2_single_points_of_failure(
        tier2_nodes, tier1_count=len(suppliers),
    )
    for spof in spofs[:5]:
        cat      = spof["tier2_category"]
        affected = spof["dependent_tier1_suppliers"]
        conf     = spof.get("confidence", 0.80)
        severity = min(10, max(6, round(conf * 9.5)))
        key      = _key("t2", cat)
        if key in seen:
            continue
        seen.add(key)

        zones_str    = spof.get("probable_zones", "key sourcing regions")
        primary_zone = zones_str.split(",")[0].strip() if zones_str else "Global"

        predictions.append({
            "id": _uid(),
            "name": f"Tier-2 SPOF: {cat}",
            "description": (
                f"{len(affected)} of your Tier-1 suppliers share a dependency on {cat}, "
                f"sourced from {zones_str}. "
                f"A single disruption at this input cascades simultaneously across all "
                f"{len(affected)} dependent suppliers — a structural single point of failure."
            ),
            "type": "Geopolitical",
            "location": primary_zone,
            "severity": severity,
            "signal_type": "category_risk",
            "signal_label": "Tier-2 SPOF",
            "signal_source": f"SPOF inference confidence: {round(conf * 100)}%",
            "confidence": round(conf * 0.90, 2),
            "affected_suppliers": affected,
            "drivers": [
                f"{len(affected)} Tier-1 suppliers share this single Tier-2 input",
                f"Sourcing concentrated in: {zones_str}",
                f"Structural cascade risk if {cat} supply fails",
                f"Inference confidence: {round(conf * 100)}%",
            ],
            "tags": ["tier-2", "spof", cat.lower().replace(" & ", "-").replace(" ", "-")],
            "is_predicted": True,
        })

    # ── Signal 5: Supply pressure (buffer + reliability stress) ──────────────
    critical_buf = [s for s in suppliers if (s.get("buffer_stock_days") or 30) < 10]
    low_rel      = [s for s in suppliers if (s.get("reliability") or 85) < 72]

    if len(critical_buf) >= 2:
        zones = sorted({s.get("zone", "") for s in critical_buf if s.get("zone")})
        key = _key("pressure", "buf")
        if key not in seen:
            seen.add(key)
            severity = min(10, 5 + len(critical_buf))
            predictions.append({
                "id": _uid(),
                "name": f"Critical Buffer Depletion — {len(critical_buf)} Suppliers",
                "description": (
                    f"{len(critical_buf)} suppliers hold <10 days of buffer stock. "
                    "Any minor shock — delayed shipment, production pause, port congestion — "
                    "triggers immediate stockouts with zero recovery window."
                ),
                "type": "Custom",
                "location": zones[0] if zones else "Multiple Zones",
                "severity": severity,
                "signal_type": "supply_pressure",
                "signal_label": "Supply Pressure",
                "signal_source": f"{len(critical_buf)} suppliers at critical buffer levels",
                "confidence": 0.86,
                "affected_suppliers": [s["name"] for s in critical_buf],
                "drivers": [
                    f"{len(critical_buf)} suppliers carrying <10 days buffer stock",
                    "Zero recovery window on any supply shock",
                    "Immediate stockout risk under minor disruption",
                    "No buffer to absorb concurrent failures",
                ],
                "tags": ["buffer", "stockout", "supply-pressure"],
                "is_predicted": True,
            })

    if len(low_rel) >= 2:
        key = _key("pressure", "rel")
        if key not in seen:
            seen.add(key)
            severity = min(10, 4 + len(low_rel))
            predictions.append({
                "id": _uid(),
                "name": f"Reliability Cluster Risk — {len(low_rel)} Underperformers",
                "description": (
                    f"{len(low_rel)} suppliers are operating below 72% reliability. "
                    "A correlated shock — shared route failure, industry strike, or severe weather — "
                    "could trigger simultaneous failures across this cluster."
                ),
                "type": "Custom",
                "location": "Multiple Zones",
                "severity": severity,
                "signal_type": "supply_pressure",
                "signal_label": "Supply Pressure",
                "signal_source": f"{len(low_rel)} suppliers below 72% reliability",
                "confidence": 0.78,
                "affected_suppliers": [s["name"] for s in low_rel],
                "drivers": [
                    f"{len(low_rel)} suppliers performing below 72% reliability",
                    "Correlated failure risk under shared stress event",
                    "Compounding impact if logistics routes overlap",
                    "Cluster failure amplifies total supply shock",
                ],
                "tags": ["reliability", "cluster-risk", "supply-pressure"],
                "is_predicted": True,
            })

    return sorted(
        predictions,
        key=lambda p: (round(p["severity"] * p["confidence"], 2),
                       _SIGNAL_PRIORITY.get(p["signal_type"], 0)),
        reverse=True,
    )


@dashboard_router.get("/api/search")
async def search_global(q: str = Query(...), types: str = "events,suppliers,audit", limit: int = 20,
                        current_user: dict = Depends(auth.require_auth)):
    """Global search across events, suppliers, and audit log."""
    from main import _resolve_suppliers, _event_timestamp
    client_id = current_user["client_id"]

    if len(q.strip()) < 2:
        raise HTTPException(status_code=400, detail="Query too short")

    limit = min(limit, 50)
    results = []
    type_list = [t.strip() for t in types.split(",")]

    if "events" in type_list:
        for event in storage.list_events():
            if event.get("client_id") != client_id:
                continue
            monitor = event.get("monitor", {})
            text = f"{monitor.get('geography', '')} {monitor.get('description', '')} {monitor.get('event_type', '')}".lower()
            if q.lower() in text:
                results.append({
                    "type": "event",
                    "id": event.get("event_id", ""),
                    "title": f"{monitor.get('event_type', '')} - {monitor.get('geography', '')}",
                    "subtitle": f"Severity {monitor.get('severity_score', '?')} | {_event_timestamp(event)[:10]}",
                    "href": "/history",
                    "meta": {"severity": monitor.get("severity_score"), "geography": monitor.get("geography")},
                })

    if "suppliers" in type_list:
        for sup in _resolve_suppliers(client_id):
            text = f"{sup.get('name', '')} {sup.get('zone', '')} {' '.join(sup.get('categories', []))}".lower()
            if q.lower() in text:
                results.append({
                    "type": "supplier",
                    "id": sup.get("id", ""),
                    "title": sup.get("name", ""),
                    "subtitle": f"Zone: {sup.get('zone', '')} | Buffer: {sup.get('buffer_stock_days', '?')}d",
                    "href": "/account/suppliers",
                    "meta": {"zone": sup.get("zone"), "reliability": sup.get("reliability")},
                })

    if "audit" in type_list:
        for entry in storage.get_audit_log(200):
            if entry.get("client_id") != client_id:
                continue
            text = f"{entry.get('action', '')} {entry.get('agent', '')}".lower()
            if q.lower() in text:
                results.append({
                    "type": "audit",
                    "id": entry.get("audit_id", ""),
                    "title": entry.get("action", ""),
                    "subtitle": f"{entry.get('agent', '')} | {entry.get('timestamp_utc', '')[:10]}",
                    "href": "/reports",
                    "meta": {"agent": entry.get("agent")},
                })

    return {"query": q, "total": len(results), "results": results[:limit]}
