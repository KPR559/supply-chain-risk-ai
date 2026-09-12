"""Central configuration for the shipment-delay prediction system.

All thresholds, paths, decay parameters and environment settings are resolved
here from environment variables / a ``.env`` file so nothing is hardcoded in
business logic.
"""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

_DOTENV_LOADED = False


def _load_dotenv() -> None:
    """Load ``.env`` at project root without the python-dotenv dependency."""
    global _DOTENV_LOADED
    if _DOTENV_LOADED:
        return
    _DOTENV_LOADED = True
    env_path = PROJECT_ROOT / ".env"
    if not env_path.exists():
        return
    try:
        for line in env_path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            key = key.strip()
            value = value.strip()
            if value.startswith('"') and value.endswith('"'):
                value = value[1:-1]
            os.environ.setdefault(key, value)
    except Exception:  # pragma: no cover - best effort
        pass


def _project_root() -> Path:
    # backend/core/config.py -> repo root (three levels up); data/, artifacts/
    # and .env stay at the root so local runs and serverless bundles agree.
    return Path(__file__).resolve().parent.parent.parent


PROJECT_ROOT: Path = _project_root()
_load_dotenv()


def _env(key: str, default: str = "") -> str:
    return os.environ.get(key, default)


def _env_int(key: str, default: int) -> int:
    try:
        return int(_env(key, str(default)))
    except (TypeError, ValueError):
        return default


def _env_float(key: str, default: float) -> float:
    try:
        return float(_env(key, str(default)))
    except (TypeError, ValueError):
        return default


@dataclass
class Settings:
    """Resolved application settings."""

    project_root: Path = PROJECT_ROOT
    app_env: str = field(default_factory=lambda: _env("APP_ENV", "development"))
    log_level: str = field(default_factory=lambda: _env("LOG_LEVEL", "INFO"))

    data_dir: Path = field(default_factory=lambda: Path(_env("DATA_DIR", "data")))
    artifact_dir: Path = field(
        default_factory=lambda: Path(_env("ARTIFACT_DIR", "artifacts"))
    )

    mc_simulations: int = field(default_factory=lambda: _env_int("MC_SIMULATIONS", 10000))
    mc_seed: int = field(default_factory=lambda: _env_int("MC_SEED", 42))

    delay_threshold_hours: float = field(
        default_factory=lambda: _env_float("DELAY_THRESHOLD_HOURS", 24.0)
    )

    conflict_decay_half_life_days: float = field(
        default_factory=lambda: _env_float("CONFLICT_DECAY_HALF_LIFE_DAYS", 30.0)
    )

    graph_backend: str = field(default_factory=lambda: _env("GRAPH_BACKEND", "networkx"))
    gat_epochs: int = field(default_factory=lambda: _env_int("GAT_EPOCHS", 40))
    neo4j_uri: str = field(default_factory=lambda: _env("NEO4J_URI", "bolt://localhost:7687"))
    neo4j_user: str = field(default_factory=lambda: _env("NEO4J_USER", "neo4j"))
    neo4j_password: str = field(default_factory=lambda: _env("NEO4J_PASSWORD", ""))

    nlp_engine: str = field(default_factory=lambda: _env("NLP_ENGINE", "local"))
    llm_api_key: str = field(default_factory=lambda: _env("LLM_API_KEY", ""))

    demo_seed: int = field(default_factory=lambda: _env_int("DEMO_SEED", 7))

    api_host: str = field(default_factory=lambda: _env("API_HOST", "0.0.0.0"))
    api_port: int = field(default_factory=lambda: _env_int("API_PORT", 8000))

    # Derived absolute paths
    @property
    def raw_dir(self) -> Path:
        return self.data_dir / "raw"

    @property
    def silver_dir(self) -> Path:
        return self.data_dir / "silver"

    @property
    def gold_dir(self) -> Path:
        return self.data_dir / "gold"

    def absolute(self, p: Path) -> Path:
        if p.is_absolute():
            return p
        return self.project_root / p

    @property
    def abs_data_dir(self) -> Path:
        return self.absolute(self.data_dir)

    @property
    def abs_artifact_dir(self) -> Path:
        return self.absolute(self.artifact_dir)


_settings: Optional[Settings] = None


def get_settings() -> Settings:
    global _settings
    if _settings is None:
        _settings = Settings()
    return _settings


def reset_settings() -> None:
    """Reset cached settings (mainly for tests)."""
    global _settings
    _settings = None
