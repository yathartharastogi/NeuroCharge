from typing import Optional
from datetime import datetime
from sqlmodel import SQLModel, Field

class TelemetryRecord(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    battery_id: str = Field(index=True, description="Target battery ID")
    voltage: float = Field(description="Voltage in Volts")
    current: float = Field(description="Current in Amperes")
    temperature: float = Field(description="Temperature in Celsius")
    charging_state: str = Field(description="Operational charging state")
    charge_cycles: int = Field(description="Charge cycle count")
    ambient_temperature: float = Field(default=25.0, description="Ambient temperature in Celsius")
    timestamp: datetime = Field(default_factory=datetime.utcnow, index=True)
    
    # Encoded Neural Spikes (discrete event representations)
    voltage_spike: int = Field(description="Voltage event spike output: -1, 0, 1")
    current_spike: int = Field(description="Current event spike output: -1, 0, 1")
    temperature_spike: int = Field(description="Temperature event spike output: -1, 0, 1")
    charge_cycles_spike: int = Field(description="Charge cycle event spike output: 0, 1")
    
    # Anomaly status
    thermal_anomaly_detected: bool = Field(default=False, description="Whether SNN LIF neuron fired an anomaly alert")
