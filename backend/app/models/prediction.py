from typing import Optional
from datetime import datetime
from sqlmodel import SQLModel, Field

class BatteryPrediction(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    battery_id: str = Field(index=True, description="Target battery ID")
    predicted_soh: float = Field(description="Predicted State of Health percentage")
    predicted_rul: int = Field(description="Predicted Remaining Useful Life in cycles")
    inference_latency_ms: float = Field(description="Inference latency in milliseconds")
    timestamp: datetime = Field(default_factory=datetime.utcnow, index=True)
