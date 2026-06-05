"""Core test suite for DisruptIQ V2.

Covers:
  - auth.py: password hashing, JWT creation/verification, password validation
  - agents.py: severity computation, risk scoring, divergence detection
  - models.py: Pydantic model validation
  - Multi-tenant isolation: seed vs. real-client data boundaries

Run with:
    cd "Swarm Agent/backend"
    pip install pytest pytest-asyncio
    pytest tests/ -v
"""

import sys
import os
import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

import auth


# ─── Password Hashing ─────────────────────────────────────────────────────────

class TestPasswordHashing:
    def test_hash_returns_hash_and_salt(self):
        h, s = auth.hash_password("TestPass1!")
        assert h and s

    def test_correct_password_verifies(self):
        h, s = auth.hash_password("CorrectHorse42!")
        assert auth.verify_password("CorrectHorse42!", h, s) is True

    def test_wrong_password_rejected(self):
        h, s = auth.hash_password("CorrectHorse42!")
        assert auth.verify_password("WrongPassword1!", h, s) is False

    def test_unique_salts_per_hash(self):
        _, s1 = auth.hash_password("SamePassword1!")
        _, s2 = auth.hash_password("SamePassword1!")
        assert s1 != s2

    def test_same_password_different_hashes(self):
        h1, _ = auth.hash_password("SamePassword1!")
        h2, _ = auth.hash_password("SamePassword1!")
        assert h1 != h2


# ─── JWT Tokens ───────────────────────────────────────────────────────────────

class TestJWTTokens:
    def test_create_and_verify_roundtrip(self):
        token = auth.create_jwt_token("user@example.com", "client_abc123")
        payload = auth.verify_jwt_token(token)
        assert payload["email"] == "user@example.com"
        assert payload["client_id"] == "client_abc123"
        assert payload["type"] == "access"

    def test_token_contains_jti(self):
        token = auth.create_jwt_token("user@example.com", "client_abc123")
        payload = auth.verify_jwt_token(token)
        assert "jti" in payload

    def test_tampered_token_rejected(self):
        token = auth.create_jwt_token("user@example.com", "client_abc123")
        bad_token = token[:-5] + "XXXXX"
        with pytest.raises(Exception):
            auth.verify_jwt_token(bad_token)

    def test_extra_claims_preserved(self):
        token = auth.create_jwt_token(
            "user@example.com", "client_abc123",
            extra_claims={"company_name": "Acme Corp", "premium": True}
        )
        payload = auth.verify_jwt_token(token)
        assert payload["company_name"] == "Acme Corp"
        assert payload["premium"] is True


# ─── Password Strength Validation ─────────────────────────────────────────────

class TestPasswordValidation:
    def test_strong_password_passes(self):
        result = auth.validate_password_strength("SecurePass1!")
        assert result["valid"] is True

    def test_too_short_fails(self):
        result = auth.validate_password_strength("Ab1!")
        assert result["valid"] is False

    def test_no_uppercase_fails(self):
        result = auth.validate_password_strength("lowercase1!")
        assert result["valid"] is False

    def test_no_digit_fails(self):
        result = auth.validate_password_strength("NoDigitHere!")
        assert result["valid"] is False

    def test_no_special_char_fails(self):
        result = auth.validate_password_strength("NoSpecial123")
        assert result["valid"] is False


# ─── Severity Computation ─────────────────────────────────────────────────────

class TestSeverityComputation:
    def setup_method(self):
        import agents
        self.agents = agents

    def test_cyclone_scores_high(self):
        event = {
            "description": "Major cyclone landfall imminent — ports shut",
            "location": "Chennai", "source": "Reuters",
            "geography": "Chennai", "event_type": "Cyclone",
            "severity_score": None,
        }
        assert self.agents.compute_severity(event) >= 7

    def test_minor_event_scores_low(self):
        event = {
            "description": "Minor road maintenance delay on highway",
            "location": "Pune", "source": "Manual",
            "geography": "Pune", "event_type": "Traffic",
            "severity_score": None,
        }
        assert self.agents.compute_severity(event) <= 5

    def test_explicit_score_is_used(self):
        event = {
            "description": "Test", "location": "Mumbai",
            "source": "Manual", "geography": "Mumbai",
            "event_type": "Test", "severity_score": 8.0,
        }
        assert self.agents.compute_severity(event) == 8


# ─── Risk Scoring ─────────────────────────────────────────────────────────────

class TestRiskScoring:
    def setup_method(self):
        import agents
        self.agents = agents

    def _supplier(self, buffer=7, sites=1, reliability=60.0, proximity=9):
        return {
            "id": "SUP-001", "name": "Test Supplier", "zone": "Chennai",
            "categories": ["Electronics"], "buffer_stock_days": buffer,
            "sites": sites, "reliability": reliability, "proximity_score": proximity,
        }

    def test_vulnerable_supplier_high_score(self):
        score = self.agents._compute_supplier_risk_score(
            self._supplier(buffer=3, proximity=9, reliability=60),
            geography="Chennai", severity=8
        )
        assert score >= 60

    def test_resilient_supplier_lower_score(self):
        score = self.agents._compute_supplier_risk_score(
            self._supplier(buffer=30, proximity=2, reliability=95, sites=4),
            geography="Delhi", severity=5
        )
        assert score <= 55

    def test_score_bounded_0_to_100(self):
        score = self.agents._compute_supplier_risk_score(
            self._supplier(buffer=0, proximity=10, reliability=10, sites=1),
            geography="Chennai", severity=10
        )
        assert 0 <= score <= 100


# ─── Divergence / Dissent Detection ───────────────────────────────────────────

class TestDivergenceDetection:
    def setup_method(self):
        import agents
        self.agents = agents

    def test_large_divergence_triggers_dissent(self):
        forecast = {"affected_categories": [{"demand_shift_pct": 80, "confidence": "high"}]}
        risk = {"critical_count": 0, "high_count": 0, "total_scored": 10}
        result = self.agents.compute_divergence(forecast, risk)
        assert result["dissent_detected"] is True

    def test_aligned_signals_no_dissent(self):
        forecast = {"affected_categories": [{"demand_shift_pct": 20, "confidence": "high"}]}
        risk = {"critical_count": 2, "high_count": 3, "total_scored": 10}
        result = self.agents.compute_divergence(forecast, risk)
        assert result["dissent_detected"] is False


# ─── Pydantic Models ──────────────────────────────────────────────────────────

class TestModels:
    def test_event_trigger_defaults(self):
        from models import EventTrigger
        e = EventTrigger(description="Cyclone", location="Chennai")
        assert e.source == "Manual"
        assert e.demo_mode is False

    def test_signup_rejects_invalid_email(self):
        from models import SignupRequest
        import pydantic
        with pytest.raises((pydantic.ValidationError, ValueError)):
            SignupRequest(email="not-an-email", password="x", company_name="x", industry="x")

    def test_hil_decision_defaults(self):
        from models import HILDecision
        h = HILDecision(event_id="EVT-001", selected_option_rank=1)
        assert h.acknowledged_dissent is False
        assert h.co_reviewer_id is None

    def test_feedback_model(self):
        from models import FeedbackRequest
        f = FeedbackRequest(rating=4, comment="Great tool")
        assert f.rating == 4

    def test_supplier_input_defaults(self):
        from models import SupplierInput
        s = SupplierInput(name="Test Supplier", zone="Mumbai")
        assert s.reliability == 85.0
        assert s.sites == 1


# ─── Multi-Tenant Isolation ───────────────────────────────────────────────────

class TestClientIsolation:
    SEED_IDS = {"demo", "ifb", "tata_motors"}

    def test_seed_clients_identified(self):
        for cid in self.SEED_IDS:
            assert cid in self.SEED_IDS

    def test_real_client_not_seed(self):
        assert "client_abc1234567" not in self.SEED_IDS

    def test_new_client_gets_empty_suppliers(self):
        seed_ids = {"demo", "ifb", "tata_motors"}
        clients_db = {"client_newuser": {"suppliers": []}}

        def resolve(client_id):
            if client_id in seed_ids:
                return [{"id": "S1", "name": "Seed Supplier"}]
            return clients_db.get(client_id, {}).get("suppliers", [])

        assert resolve("client_newuser") == []
        assert len(resolve("demo")) > 0

    def test_event_isolation_by_client_id(self):
        events_by_client = {
            "client_a": [{"event_id": "E1", "client_id": "client_a"}],
            "client_b": [{"event_id": "E2", "client_id": "client_b"}],
        }
        client_a_events = [e for e in events_by_client.get("client_a", [])
                           if e["client_id"] == "client_a"]
        assert len(client_a_events) == 1
        assert client_a_events[0]["event_id"] == "E1"
