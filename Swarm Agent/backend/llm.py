"""
DisruptIQ V2 — LLM client and Azure AI Content Safety client.

In demo mode (no GitHub token), returns deterministic synthetic responses.
"""

import json
import asyncio
import logging
from datetime import datetime, timezone

import httpx
import config

logger = logging.getLogger("disruptiq.llm")


# ════════════════════════════════════════════════════════════════════════════
# GitHub Models API client (GPT-4o)
# ════════════════════════════════════════════════════════════════════════════

class LLMError(Exception):
    pass


# Degraded-mode tracking so silent LLM failures (quota exhaustion, network) are
# visible in GET /health rather than masquerading as real model output.
_llm_state = {
    "degraded": False,
    "fallback_count": 0,
    "last_failure_at": None,
    "last_failure_reason": None,
    "total_calls": 0,
    "success_calls": 0,
}


def get_llm_health() -> dict:
    """Snapshot of LLM call health for the /health endpoint."""
    total = _llm_state["total_calls"]
    return {
        "degraded": _llm_state["degraded"],
        "fallback_count_session": _llm_state["fallback_count"],
        "last_failure_at": _llm_state["last_failure_at"],
        "last_failure_reason": _llm_state["last_failure_reason"],
        "success_rate_pct": round(_llm_state["success_calls"] / total * 100, 1) if total else 100.0,
    }


def _record_llm_success() -> None:
    _llm_state["success_calls"] += 1
    if _llm_state["degraded"]:
        _llm_state["degraded"] = False
        logger.info("LLM recovered from degraded mode")


def _record_llm_failure(exc: Exception) -> None:
    _llm_state["degraded"] = True
    _llm_state["fallback_count"] += 1
    _llm_state["last_failure_at"] = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    _llm_state["last_failure_reason"] = str(exc)[:200]
    logger.warning("LLM call failed (fallback #%s): %s", _llm_state["fallback_count"], exc)


async def chat_json(system: str, user: str, max_tokens: int = 800,
                    fallback: dict = None, temperature: float = 0.3) -> dict:
    """Call GPT-4o, request JSON. Returns parsed dict. Falls back to provided dict."""
    if not config.is_real_llm():
        return fallback or {}
    payload = {
        "model": config.GITHUB_MODEL,
        "messages": [
            {"role": "system", "content": system + "\n\nRespond ONLY with valid JSON. No prose, no markdown fences."},
            {"role": "user", "content": user},
        ],
        "max_tokens": max_tokens,
        "temperature": temperature,
        "response_format": {"type": "json_object"},
    }
    headers = {
        "Authorization": f"Bearer {config.GITHUB_TOKEN}",
        "Content-Type": "application/json",
    }
    _llm_state["total_calls"] += 1
    try:
        async with httpx.AsyncClient(timeout=45) as client:
            r = await client.post(f"{config.GITHUB_MODELS_ENDPOINT}/chat/completions",
                                  headers=headers, json=payload)
            r.raise_for_status()
            content = r.json()["choices"][0]["message"]["content"].strip()
            content = content.replace("```json", "").replace("```", "").strip()
            parsed = json.loads(content)
            _record_llm_success()
            return parsed
    except Exception as e:
        _record_llm_failure(e)
        return fallback or {}


async def chat_text(system: str, user: str, max_tokens: int = 400,
                    fallback: str = "", temperature: float = 0.3) -> str:
    """Call GPT-4o, return free text."""
    if not config.is_real_llm():
        return fallback
    payload = {
        "model": config.GITHUB_MODEL,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        "max_tokens": max_tokens,
        "temperature": temperature,
    }
    headers = {
        "Authorization": f"Bearer {config.GITHUB_TOKEN}",
        "Content-Type": "application/json",
    }
    _llm_state["total_calls"] += 1
    try:
        async with httpx.AsyncClient(timeout=45) as client:
            r = await client.post(f"{config.GITHUB_MODELS_ENDPOINT}/chat/completions",
                                  headers=headers, json=payload)
            r.raise_for_status()
            text = r.json()["choices"][0]["message"]["content"].strip()
            _record_llm_success()
            return text
    except Exception as e:
        _record_llm_failure(e)
        return fallback


# ════════════════════════════════════════════════════════════════════════════
# Azure AI Content Safety client (Risk Agent + NL output filter — BR-004, NFR-08)
# ════════════════════════════════════════════════════════════════════════════

async def content_safety_check(text: str) -> dict:
    """Returns {'safe': bool, 'categories': {...}}.
    In demo mode, always passes (mock filter logs the call)."""
    if not config.is_real_content_safety():
        return {"safe": True, "categories": {}, "demo_mode": True}
    headers = {
        "Ocp-Apim-Subscription-Key": config.CONTENT_SAFETY_KEY,
        "Content-Type": "application/json",
    }
    body = {"text": text[:10000], "categories": ["Hate", "Violence", "SelfHarm", "Sexual"]}
    url = f"{config.CONTENT_SAFETY_ENDPOINT.rstrip('/')}/contentsafety/text:analyze?api-version=2023-10-01"
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            r = await client.post(url, headers=headers, json=body)
            r.raise_for_status()
            data = r.json()
            cats = {c["category"]: c.get("severity", 0) for c in data.get("categoriesAnalysis", [])}
            unsafe = any(s > 2 for s in cats.values())
            return {"safe": not unsafe, "categories": cats, "demo_mode": False}
    except Exception as e:
        logger.warning("content_safety check failed, defaulting to safe: %s", e)
        return {"safe": True, "categories": {}, "demo_mode": False, "error": str(e)}
