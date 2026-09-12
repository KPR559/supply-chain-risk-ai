"""Pydantic schemas for the API layer."""
from __future__ import annotations

from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, Field


class PredictRequest(BaseModel):
    origin: str = Field(default="frankfurt", description="Origin node id")
    destination: str = Field(default="final_destination", description="Destination node id")
    route_id: str = Field(default="suez", description="Route id (suez | cape | dubai)")
    current_checkpoint: Optional[str] = Field(default=None, description="Current position node id")
    deadline_date: Optional[str] = Field(default=None, description="Promised delivery date (YYYY-MM-DD)")
    origin_date: Optional[str] = Field(default=None, description="Sailing date (defaults to last data date)")
    n_sim: Optional[int] = Field(default=None, ge=100, le=100_000, description="Monte Carlo draws")


class SimulateRequest(BaseModel):
    route_id: str = "suez"
    n_sim: Optional[int] = None
    deadline_date: Optional[str] = None
    node_quantiles: Optional[Dict[str, Dict[str, float]]] = None


class ScenarioAdjustment(BaseModel):
    congestion_mult: Optional[float] = 1.0
    weather_shift: Optional[float] = 0.0
    conflict_mult: Optional[float] = 1.0
    close: Optional[bool] = False


class WhatIfRequest(BaseModel):
    shipment_id: str
    name: str = "Custom scenario"
    node_id: Optional[str] = None
    adjustments: Optional[ScenarioAdjustment] = None


class CompareRoutesRequest(BaseModel):
    shipment_id: str
    objectives: List[Literal["fastest", "lowest_risk", "lowest_uncertainty", "balanced"]] = ["fastest", "lowest_risk", "balanced"]


class GetShipmentResponse(BaseModel):
    shipment_id: str
    origin: str
    destination: str


class ExplanationResponse(BaseModel):
    node_id: str
    node_label: str
    delay_probability: float
    top_factors: List[Dict[str, Any]]
    from_model: bool = True


class HealthResponse(BaseModel):
    status: str = "ok"
    models: List[str] = []
    data: Dict[str, Any] = {}