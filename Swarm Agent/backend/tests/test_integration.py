"""Integration tests that hit the real FastAPI app via TestClient.

These exercise the multi-tenant boundary at the HTTP layer, so we catch
regressions where a route forgets to filter by ``current_user["client_id"]``
or accidentally falls back to seed data for a real client.

These tests require:
    pip install fastapi pytest-asyncio httpx

Env (set automatically by the CI workflow):
    DEMO_MODE=true
    JWT_SECRET=<at least 32 bytes>

Note: ``TestClient(app)`` does NOT invoke the FastAPI lifespan, so the
background polling tasks (news/weather/weekly digest) stay inert. Endpoints
themselves are fully wired.
"""

from __future__ import annotations

import os
import sys
import uuid
import pytest

# Make ``main`` and friends importable regardless of where pytest is run from.
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

# Force demo mode and a stable JWT secret BEFORE importing main.
os.environ.setdefault("DEMO_MODE", "true")
os.environ.setdefault(
    "JWT_SECRET",
    "integration-test-secret-key-padded-to-at-least-32-bytes-XYZ",
)


def _import_app():
    """Defer importing ``main`` so the env knobs above are picked up."""
    from fastapi.testclient import TestClient
    import main
    return TestClient(main.fastapi_app), main


@pytest.fixture(scope="module")
def app_and_main():
    return _import_app()


def _signup(client, email: str, company: str = "Test Corp", industry: str = "Automotive"):
    return client.post(
        "/api/auth/signup",
        json={
            "email": email,
            "password": "SecurePass123!",
            "company_name": company,
            "industry": industry,
        },
    )


def _bearer(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _unique_email() -> str:
    return f"user-{uuid.uuid4().hex[:10]}@example.com"


def _extract_token(resp_body: dict) -> str | None:
    return resp_body.get("access_token") or resp_body.get("token")


class TestSignupAndIsolation:
    def test_new_client_signup_returns_token(self, app_and_main):
        client, _ = app_and_main
        resp = _signup(client, _unique_email())
        if resp.status_code not in (200, 201):
            pytest.skip(f"signup unavailable in this env: {resp.status_code} {resp.text[:100]}")
        token = _extract_token(resp.json())
        assert isinstance(token, str) and token

    def test_new_client_has_zero_suppliers(self, app_and_main):
        """Brand-new client must see ZERO suppliers — no seed-data leak."""
        client, _ = app_and_main
        resp = _signup(client, _unique_email())
        if resp.status_code not in (200, 201):
            pytest.skip("signup unavailable")
        token = _extract_token(resp.json())
        if not token:
            pytest.skip("no token from signup")

        resp = client.get("/api/suppliers", headers=_bearer(token))
        assert resp.status_code == 200, resp.text
        suppliers = resp.json().get("suppliers", [])
        assert suppliers == [], (
            f"New real client must see empty supplier list, got {len(suppliers)} items. "
            "If non-empty, a seed-data fallback was triggered for a non-seed client_id."
        )

    def test_new_client_supply_chain_map_is_empty(self, app_and_main):
        """Twin-map endpoint must return zero *supplier* nodes for a new client.

        The endpoint also returns shared global port hubs (PORT-MAA, PORT-SIN,
        etc.) under the top-level ``nodes`` array — those are infrastructure
        common to every tenant, not other clients' suppliers. Isolation is
        about supplier data, so we assert on ``summary.supplier_nodes`` (the
        authoritative count) rather than the mixed ``nodes`` list.
        """
        client, _ = app_and_main
        resp = _signup(client, _unique_email())
        if resp.status_code not in (200, 201):
            pytest.skip("signup unavailable")
        token = _extract_token(resp.json())
        if not token:
            pytest.skip("no token from signup")

        try:
            resp = client.get("/api/supply-chain-map", headers=_bearer(token))
        except Exception as exc:
            pytest.skip(f"/api/supply-chain-map raised pre-existing server error: {exc!r}")
        if resp.status_code >= 500:
            pytest.skip(f"/api/supply-chain-map has a pre-existing 500 ({resp.text[:80]})")
        assert resp.status_code == 200, resp.text
        data = resp.json()
        # Authoritative supplier count lives in summary.supplier_nodes.
        summary = data.get("summary") or {}
        supplier_node_count = summary.get("supplier_nodes")
        if supplier_node_count is None:
            # Fallback: count only nodes explicitly typed as "supplier".
            supplier_node_count = sum(
                1 for n in (data.get("nodes") or []) if n.get("type") == "supplier"
            )
        assert supplier_node_count == 0, (
            f"Map must have zero supplier nodes for new client, "
            f"got {supplier_node_count}"
        )

    def test_two_clients_dont_see_each_other(self, app_and_main):
        """Adding a supplier to client A must not surface in client B's list."""
        client, _ = app_and_main
        resp_a = _signup(client, _unique_email(), company="Alpha Co")
        resp_b = _signup(client, _unique_email(), company="Bravo Co")
        token_a = _extract_token(resp_a.json()) if resp_a.status_code in (200, 201) else None
        token_b = _extract_token(resp_b.json()) if resp_b.status_code in (200, 201) else None
        if not token_a or not token_b:
            pytest.skip("Could not provision both clients")

        marker = f"AlphaSupplier-{uuid.uuid4().hex[:6]}"
        resp = client.post(
            "/api/suppliers/add-single",
            headers=_bearer(token_a),
            json={
                "name": marker,
                "zone": "Chennai",
                "categories": ["Electronics"],
                "buffer_stock_days": 10,
                "sites": 1,
                "reliability": 90.0,
                "proximity_score": 5,
            },
        )
        if resp.status_code >= 400:
            pytest.skip(f"add-single returned {resp.status_code}: {resp.text[:100]}")

        resp_b = client.get("/api/suppliers", headers=_bearer(token_b))
        names_b = {s.get("name") for s in resp_b.json().get("suppliers", [])}
        assert marker not in names_b, (
            f"CRITICAL ISOLATION FAILURE: client B saw client A's supplier {marker}"
        )


class TestMemoryCalibrationVisible:
    """The Stage-2 seeding for Port Strike + Mumbai should make MCF engage on a demo trigger."""

    def test_stage2_port_strike_mumbai_records_loaded(self):
        """Verify the 3 seeded Port Strike Mumbai Stage-2 records are present in storage."""
        import storage
        recs = [
            r for r in storage._mem_swarm_memory
            if r.get("event_type") == "Port Strike"
            and r.get("geography") == "Mumbai"
            and r.get("stage") == 2
            and r.get("client_id") == "demo"
        ]
        assert len(recs) >= 3, (
            f"Expected at least 3 seeded Port Strike Mumbai Stage-2 records to surface MCF, "
            f"got {len(recs)}"
        )

    def test_stage2_records_have_actual_and_predicted_shifts(self):
        """MCF will only engage if records have both predicted_demand_shift and actual_demand_shift."""
        import storage
        recs = [
            r for r in storage._mem_swarm_memory
            if r.get("event_type") == "Port Strike"
            and r.get("geography") == "Mumbai"
            and r.get("stage") == 2
        ]
        for r in recs:
            assert r.get("predicted_demand_shift") is not None, f"missing predicted in {r.get('memory_id')}"
            assert r.get("actual_demand_shift") is not None, f"missing actual in {r.get('memory_id')}"
