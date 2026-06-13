from pydantic import BaseModel, Field
from typing import List, Dict, Optional, Literal
from datetime import datetime
from app.schemas.telemetry import TelemetryInput

class BatteryStatusResponse(BaseModel):
    battery_id: str = Field(..., description="Target battery pack identifier")
    latest_telemetry: Optional[TelemetryInput] = Field(None, description="Most recent telemetry frame recorded")
    thermal_anomaly_active: bool = Field(..., description="Active thermal anomaly flag computed from SNN history")
    membrane_potential: float = Field(0.0, description="Latest membrane potential of the SNN LIF neuron")
    timestamp: datetime = Field(..., description="Time of status query")

class BatteryHealthResponse(BaseModel):
    battery_id: str = Field(..., description="Target battery pack identifier")
    state_of_health: float = Field(..., description="State of Health percentage (SOH)")
    status: Literal["excellent", "good", "warning", "critical"] = Field(..., description="Descriptive cell health status")
    charge_cycles: int = Field(..., description="Total completed charge-discharge cycles")
    capacity_retention_soh: float = Field(..., description="Capacity retention matching SOH")
    timestamp: datetime = Field(..., description="Time of health evaluation")

class ProjectedDecayPoint(BaseModel):
    cycles: int = Field(..., description="Cycle count marker")
    projected_soh: float = Field(..., description="Projected State of Health (SOH) percentage")

class BatteryPredictionsResponse(BaseModel):
    battery_id: str = Field(..., description="Target battery pack identifier")
    predicted_soh: float = Field(..., description="Predicted State of Health (SOH)")
    predicted_rul: int = Field(..., description="Predicted Remaining Useful Life (RUL) in cycles")
    projected_decay_curve: List[ProjectedDecayPoint] = Field(..., description="Projected linear/exponential SOH decay path")
    inference_latency_ms: float = Field(..., description="Model computation execution time in milliseconds")
    timestamp: datetime = Field(..., description="Prediction generation timestamp")

class BatteryRecommendationsResponse(BaseModel):
    battery_id: str = Field(..., description="Target battery pack identifier")
    recommendations: List[str] = Field(..., description="List of action items to prolong battery lifespan")
    warnings: List[str] = Field(..., description="Critical warning alerts based on parameter violations")
    timestamp: datetime = Field(..., description="Recommendation computation timestamp")
