"""LLM provider abstraction for Ollama (OpenAI-compatible).

Ollama exposes an OpenAI-compatible API at ``/v1`` so we reuse the ``openai``
SDK with a local base URL.  No API key is required — the config accepts a
placeholder (``"ollama"`` by default).

Usage::

    from core.llm import get_llm

    llm = get_llm()
    reply = llm.chat("Summarise the delay situation at Suez Canal.")
    health = llm.health()
"""
from __future__ import annotations

import json
import logging
import urllib.request
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

@dataclass
class LLMConfig:
    """Runtime-resolved LLM settings.  Values mirror ``core.config.Settings``
    and are populated from env vars (via ``get_settings()``)."""

    provider: str = "ollama"
    model: str = "llama3.2:latest"
    base_url: str = "http://localhost:11434"
    api_key: str = "ollama"
    temperature: float = 0.3
    max_tokens: int = 2048
    timeout: float = 120.0

    @classmethod
    def from_settings(cls, s: Any = None) -> "LLMConfig":
        if s is None:
            from backend.core.config import get_settings
            s = get_settings()
        return cls(
            provider=getattr(s, "llm_provider", "ollama"),
            model=getattr(s, "llm_model", "llama3.2:latest"),
            base_url=getattr(s, "llm_base_url", "http://localhost:11434"),
            api_key=getattr(s, "llm_api_key", "") or "ollama",
            temperature=getattr(s, "llm_temperature", 0.3),
            max_tokens=getattr(s, "llm_max_tokens", 2048),
            timeout=getattr(s, "llm_timeout", 120.0),
        )


# ---------------------------------------------------------------------------
# Provider protocol (what consumers depend on)
# ---------------------------------------------------------------------------

class LLMProvider:
    """Minimal interface that callers use.  Implemented by ``OllamaProvider``."""

    def chat(
        self,
        prompt: str,
        *,
        system: str | None = None,
        temperature: float | None = None,
        max_tokens: int | None = None,
    ) -> str:
        ...

    def chat_messages(
        self,
        messages: List[Dict[str, str]],
        *,
        temperature: float | None = None,
        max_tokens: int | None = None,
    ) -> str:
        ...

    def health(self) -> Dict[str, Any]:
        ...

    def get_models(self) -> List[str]:
        ...

    def is_available(self) -> bool:
        ...


# ---------------------------------------------------------------------------
# Ollama implementation
# ---------------------------------------------------------------------------

class OllamaProvider(LLMProvider):
    """LLM provider backed by Ollama's OpenAI-compatible API."""

    def __init__(self, config: LLMConfig | None = None):
        self._cfg = config or LLMConfig()
        self._client: Any = None  # lazily created

    def _ensure_client(self) -> Any:
        if self._client is not None:
            return self._client
        try:
            from openai import OpenAI
        except ImportError:
            raise RuntimeError(
                "The ``openai`` package is required for LLM support.  "
                "Install it with: pip install openai"
            )
        self._client = OpenAI(
            base_url=f"{self._cfg.base_url.rstrip('/')}/v1",
            api_key=self._cfg.api_key or "ollama",
            timeout=self._cfg.timeout,
        )
        return self._client

    # -- public API ---------------------------------------------------------

    def chat(
        self,
        prompt: str,
        *,
        system: str | None = None,
        temperature: float | None = None,
        max_tokens: int | None = None,
    ) -> str:
        messages: List[Dict[str, str]] = []
        if system:
            messages.append({"role": "system", "content": system})
        messages.append({"role": "user", "content": prompt})
        return self.chat_messages(
            messages,
            temperature=temperature,
            max_tokens=max_tokens,
        )

    def chat_messages(
        self,
        messages: List[Dict[str, str]],
        *,
        temperature: float | None = None,
        max_tokens: int | None = None,
    ) -> str:
        client = self._ensure_client()
        resp = client.chat.completions.create(
            model=self._cfg.model,
            messages=messages,
            temperature=temperature if temperature is not None else self._cfg.temperature,
            max_tokens=max_tokens or self._cfg.max_tokens,
        )
        return (resp.choices[0].message.content or "").strip()

    def health(self) -> Dict[str, Any]:
        """Ping the Ollama server and return status + model info."""
        base = self._cfg.base_url.rstrip("/")
        try:
            with urllib.request.urlopen(f"{base}/api/tags", timeout=5) as r:
                data = json.loads(r.read().decode("utf-8"))
            models = [m.get("name", "") for m in data.get("models", [])]
            return {
                "status": "ok",
                "provider": self._cfg.provider,
                "model": self._cfg.model,
                "base_url": base,
                "available_models": models,
                "model_loaded": any(self._cfg.model in m for m in models),
            }
        except Exception as exc:
            return {
                "status": "error",
                "provider": self._cfg.provider,
                "model": self._cfg.model,
                "base_url": base,
                "error": str(exc),
            }

    def get_models(self) -> List[str]:
        """Return the list of models currently available on the Ollama server."""
        base = self._cfg.base_url.rstrip("/")
        try:
            with urllib.request.urlopen(f"{base}/api/tags", timeout=5) as r:
                data = json.loads(r.read().decode("utf-8"))
            return [m.get("name", "") for m in data.get("models", [])]
        except Exception:
            return []

    def is_available(self) -> bool:
        """Quick check: Ollama server reachable and configured model present."""
        h = self.health()
        return h["status"] == "ok" and h.get("model_loaded", False)


# ---------------------------------------------------------------------------
# Singleton
# ---------------------------------------------------------------------------

_llm: Optional[LLMProvider] = None


def get_llm() -> LLMProvider:
    """Return the singleton LLM provider (creates on first call)."""
    global _llm
    if _llm is None:
        cfg = LLMConfig.from_settings()
        if cfg.provider == "ollama":
            _llm = OllamaProvider(cfg)
        else:
            raise ValueError(f"Unknown LLM_PROVIDER: {cfg.provider!r} (supported: ollama)")
    return _llm


def reset_llm() -> None:
    """Reset the singleton (for tests or hot-reloading config)."""
    global _llm
    _llm = None
