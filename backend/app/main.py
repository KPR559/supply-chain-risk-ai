"""FastAPI application entrypoint.

Run locally:  uvicorn backend.app.main:app --host 0.0.0.0 --port 8000
"""
from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from backend.app.api.routes import router
from backend.core.config import get_settings
from backend.core.logging_util import get_logger

log = get_logger("backend.app.main")


@asynccontextmanager
async def lifespan(app: FastAPI):
    log.info("backend starting")
    yield
    log.info("backend stopped")


app = FastAPI(
    title="Shipment Delay Prediction API",
    description=(
        "Frankfurt -> India freight-corridor delay prediction: per-node risk, "
        "delay quantiles, Monte Carlo ETA, critical nodes, SHAP explanations, "
        "GAT graph residuals, what-if scenarios and route comparison."
    ),
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # demo: tighten in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router, prefix="/api/v1")


@app.get("/")
def root() -> dict:
    return {
        "service": "shipment-delay-prediction",
        "docs": "/docs",
        "health": "/api/v1/health",
        "demo": "/api/v1/demo",
    }


def main() -> None:
    s = get_settings()
    import uvicorn

    uvicorn.run("backend.app.main:app", host=s.api_host, port=s.api_port, log_level="info")


if __name__ == "__main__":
    main()