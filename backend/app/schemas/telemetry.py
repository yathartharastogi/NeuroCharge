from pydantic import BaseModel, Field, field_validator
from typing import List, Dict, Optional, Literal
from datetime import datetime

class TelemetryInput(BaseModel):
    battery_id: str = Field(..., description="Unique identifier for the battery pack", examples=["BAT-98302"])
    voltage: float = Field(..., description="Continuous voltage reading in Volts (V)", ge=0.0, le=100.0, examples=[3.72])
    current: float = Field(..., description="Continuous current reading in Amperes (A). Positive indicates charging, negative indicates discharging.", examples=[12.5])
    temperature: float = Field(..., description="Battery cell temperature in Celsius (°C)", ge=-40.0, le=120.0, examples=[28.4])
    charging_state: Literal["charging", "discharging", "idle"] = Field(..., description="Current operational state of the battery", examples=["charging"])
    charge_cycles: int = Field(..., description="Cumulative complete charge-discharge cycles", ge=0, examples=[142])
    ambient_temperature: Optional[float] = Field(25.0, description="Ambient room/external temperature in Celsius (°C)", ge=-40.0, le=60.0)
    timestamp: Optional[datetime] = Field(default_factory=datetime.utcnow, description="UTC timestamp of the telemetry reading")

    @field_validator("charging_state")
    @classmethod
    def validate_charging_state(cls, v: str) -> str:
        v_lower = v.lower()
        if v_lower not in ["charging", "discharging", "idle"]:
            raise ValueError("charging_state must be 'charging', 'discharging', or 'idle'")
        return v_lower

class SpikeOutput(BaseModel):
    voltage: int = Field(..., description="Voltage spike: 1 (Up), -1 (Down), 0 (No spike)", ge=-1, le=1)
    current: int = Field(..., description="Current spike: 1 (Up), -1 (Down), 0 (No spike)", ge=-1, le=1)
    temperature: int = Field(..., description="Temperature spike: 1 (Up), -1 (Down), 0 (No spike)", ge=-1, le=1)
    charge_cycles: int = Field(..., description="Charge cycle event: 1 (Triggered), 0 (No trigger)", ge=0, le=1)

class TelemetryResponse(BaseModel):
    battery_id: str = Field(..., description="Unique identifier for the battery pack")
    timestamp: datetime = Field(..., description="Timestamp of telemetry ingestion")
    spikes: SpikeOutput = Field(..., description="Generated discrete neural spikes from the delta-modulation encoder")
    thermal_anomaly_detected: bool = Field(..., description="True if SNN detected an immediate thermal anomaly")
    prediction_triggered: bool = Field(..., description="True if long-term degradation inference task was successfully queued")
    processing_latency_ms: float = Field(..., description="Endpoint processing time in milliseconds")
