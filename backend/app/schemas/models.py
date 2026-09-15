"""Pydantic schemas for the API layer."""
from __future__ import annotations

from typing import Any, Dict, List, Literal, Optional
from pydantic import BaseModel, Field


class PredictRequest(BaseModel):
    origin: str = Field(default="shanghai", description="Origin node id")
    destination: str = Field(default="rotterdam", description="Destination node id")
    route_id: str = Field(default="asia_europe_suez", description="Route id")
    current_checkpoint: Optional[str] = Field(default=None, description="Current position node id")
    deadline_date: Optional[str] = Field(default=None, description="Promised delivery date (YYYY-MM-DD)")
    origin_date: Optional[str] = Field(default=None, description="Sailing date (defaults to last data date)")
    n_sim: Optional[int] = Field(default=None, ge=100, le=100_000, description="Monte Carlo draws")
    seed: Optional[int] = Field(default=None, description="MC seed (for reproducibility)")


class SimulateRequest(BaseModel):
    route_id: str = "asia_europe_suez"
    n_sim: Optional[int] = None
    deadline_date: Optional[str] = None
    node_quantiles: Optional[Dict[str, Dict[str, float]]] = None


class ScenarioAdjustment(BaseModel):
    congestion_mult: Optional[float] = 1.0
    weather_shift: Optional[float] = 0.0
    conflict_mult: Optional[float] = 1.0
    close: Optional[bool] = False


class NodeAdjustment(BaseModel):
    node_id: str
    congestion_mult: Optional[float] = 1.0
    weather_shift: Optional[float] = 0.0
    conflict_mult: Optional[float] = 1.0
    close: Optional[bool] = False


class WhatIfRequest(BaseModel):
    shipment_id: str
    name: str = "Custom scenario"
    scenario_type: Literal["baseline", "congestion", "weather", "closure", "multi_checkpoint", "route_level", "custom"] = "custom"
    scope: Literal["single", "segment", "multi", "route"] = "single"
    node_id: Optional[str] = None
    node_ids: Optional[List[str]] = None
    segment_start: Optional[str] = None
    segment_end: Optional[str] = None
    adjustments: Optional[ScenarioAdjustment] = None
    node_adjustments: Optional[List[NodeAdjustment]] = None
    route_adjustments: Optional[ScenarioAdjustment] = None
    custom_name: Optional[str] = None


class CompareRoutesRequest(BaseModel):
    shipment_id: str
    objectives: List[Literal["fastest", "lowest_risk", "lowest_uncertainty", "balanced"]] = ["fastest", "lowest_risk", "balanced"]


class LLMExplainRequest(BaseModel):
    """Payload for LLM narrative panels. ``prediction`` is the full stored
    prediction dict (the engine already computed everything the LLM may cite)."""
    prediction: Dict[str, Any]
    explanation: Optional[Dict[str, Any]] = None
    critical: Optional[Dict[str, Any]] = None
    recommendations: Optional[List[Dict[str, Any]]] = None
    panels: Optional[List[str]] = Field(default=None, description="Panels to generate (situation|risk|recommendations|eta|deadline|drivers|trend|node|edge)")
    trend: Optional[Dict[str, Any]] = None
    node_id: Optional[str] = None
    node: Optional[Dict[str, Any]] = None
    edge: Optional[Dict[str, Any]] = None


class LLMChatRequest(BaseModel):
    prediction: Dict[str, Any]
    question: str = Field(min_length=1, max_length=1000)
    history: Optional[List[Dict[str, str]]] = None


class LLMReportRequest(BaseModel):
    prediction: Dict[str, Any]
    explanation: Optional[Dict[str, Any]] = None
    critical: Optional[Dict[str, Any]] = None


class LoginRequest(BaseModel):
    username: str
    password: str


class RegisterRequest(BaseModel):
    username: str = Field(min_length=3, max_length=32, pattern=r"^[A-Za-z0-9_.-]+$",
                          description="3-32 chars: letters, digits, _ . -")
    password: str = Field(min_length=8, max_length=128,
                          description="Minimum 8 characters")


class ForgotRequest(BaseModel):
    username: str


class ResetRequest(BaseModel):
    token: str
    new_password: str = Field(min_length=8, max_length=128)


class ChangePasswordRequest(BaseModel):
    old_password: str
    new_password: str = Field(min_length=8, max_length=128)


class UpdateProfileRequest(BaseModel):
    avatar: Optional[str] = Field(
        default=None, max_length=500_000,
        description="Profile picture as a data URL (data:image/...;base64,...)",
    )


class ChangeUsernameRequest(BaseModel):
    new_username: str = Field(min_length=3, max_length=32, pattern=r"^[A-Za-z0-9_.-]+$",
                              description="3-32 chars: letters, digits, _ . -")


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
