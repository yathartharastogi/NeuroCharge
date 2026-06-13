import logging
from datetime import datetime
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, status
from sqlmodel import Session, select, desc
from app.db.database import get_session
from app.models.user import User
from app.models.telemetry import TelemetryRecord
from app.models.prediction import BatteryPrediction
from app.api.deps import get_current_user
from app.schemas.telemetry import TelemetryInput
from app.schemas.battery import (
    BatteryStatusResponse,
    BatteryHealthResponse,
    BatteryPredictionsResponse,
    BatteryRecommendationsResponse,
    ProjectedDecayPoint
)

from app.services.prediction import snn_detector

logger = logging.getLogger("neurocharge.api.battery")
router = APIRouter()

@router.get(
    "/{battery_id}/status",
    response_model=BatteryStatusResponse,
    summary="Get the latest battery status",
    description="Queries database for the most recent telemetry entry and active anomaly flags."
)
async def get_battery_status(
    battery_id: str,
    db: Session = Depends(get_session),
    current_user: User = Depends(get_current_user)
):
    # Fetch the latest telemetry record for the given battery
    statement = select(TelemetryRecord).where(TelemetryRecord.battery_id == battery_id).order_by(desc(TelemetryRecord.timestamp))
    latest = db.exec(statement).first()
    
    anomaly_active = latest.thermal_anomaly_detected if latest else False
    membrane_pot = snn_detector._membrane_potentials.get(battery_id, 0.0)
    
    telemetry_input = None
    if latest:
        telemetry_input = TelemetryInput(
            battery_id=latest.battery_id,
            voltage=latest.voltage,
            current=latest.current,
            temperature=latest.temperature,
            charging_state=latest.charging_state,
            charge_cycles=latest.charge_cycles,
            ambient_temperature=latest.ambient_temperature,
            timestamp=latest.timestamp
        )
        
    return BatteryStatusResponse(
        battery_id=battery_id,
        latest_telemetry=telemetry_input,
        thermal_anomaly_active=anomaly_active,
        membrane_potential=round(membrane_pot, 3),
        timestamp=datetime.utcnow()
    )

@router.get(
    "/{battery_id}/health",
    response_model=BatteryHealthResponse,
    summary="Get the battery health status",
    description="Calculates capacity retention and health status category based on cycles and predictions."
)
async def get_battery_health(
    battery_id: str,
    db: Session = Depends(get_session),
    current_user: User = Depends(get_current_user)
):
    # Get latest telemetry to check current cycles
    telemetry_statement = select(TelemetryRecord).where(TelemetryRecord.battery_id == battery_id).order_by(desc(TelemetryRecord.timestamp))
    latest_telemetry = db.exec(telemetry_statement).first()
    
    cycles = latest_telemetry.charge_cycles if latest_telemetry else 0
    
    # Get latest prediction
    prediction_statement = select(BatteryPrediction).where(BatteryPrediction.battery_id == battery_id).order_by(desc(BatteryPrediction.timestamp))
    latest_prediction = db.exec(prediction_statement).first()
    
    if latest_prediction:
        soh = latest_prediction.predicted_soh
    else:
        # Fallback calculation if no background prediction has completed yet
        temp = latest_telemetry.temperature if latest_telemetry else 25.0
        soh_decay = min(15.0, (cycles * 0.005) + max(0.0, (temp - 25) * 0.05))
        soh = max(0.0, 100.0 - soh_decay)
        
    # Categorize status
    if soh >= 98.0:
        health_status = "excellent"
    elif soh >= 90.0:
        health_status = "good"
    elif soh >= 80.0:
        health_status = "warning"
    else:
        health_status = "critical"
        
    return BatteryHealthResponse(
        battery_id=battery_id,
        state_of_health=round(soh, 3),
        status=health_status,
        charge_cycles=cycles,
        capacity_retention_soh=round(soh, 3),
        timestamp=datetime.utcnow()
    )

@router.get(
    "/{battery_id}/predictions",
    response_model=BatteryPredictionsResponse,
    summary="Get long-term degradation predictions",
    description="Retrieves SOH and RUL predictions, along with a projected capacity decay timeline."
)
async def get_battery_predictions(
    battery_id: str,
    db: Session = Depends(get_session),
    current_user: User = Depends(get_current_user)
):
    # Get latest prediction
    prediction_statement = select(BatteryPrediction).where(BatteryPrediction.battery_id == battery_id).order_by(desc(BatteryPrediction.timestamp))
    latest_prediction = db.exec(prediction_statement).first()
    
    # Get latest telemetry
    telemetry_statement = select(TelemetryRecord).where(TelemetryRecord.battery_id == battery_id).order_by(desc(TelemetryRecord.timestamp))
    latest_telemetry = db.exec(telemetry_statement).first()
    cycles = latest_telemetry.charge_cycles if latest_telemetry else 0
    temp = latest_telemetry.temperature if latest_telemetry else 25.0
    
    if latest_prediction:
        predicted_soh = latest_prediction.predicted_soh
        predicted_rul = latest_prediction.predicted_rul
        latency = latest_prediction.inference_latency_ms
    else:
        # Mock/fallback calculation values
        soh_decay = min(15.0, (cycles * 0.005) + max(0.0, (temp - 25) * 0.05))
        predicted_soh = max(0.0, 100.0 - soh_decay)
        predicted_rul = max(0, 1500 - cycles)
        latency = 0.0
        
    # Generate projected decay curve starting from current cycle count to 1500 cycles
    decay_curve = []
    
    # 4 curve markers (e.g. current, 500, 1000, 1500 cycles)
    cycle_markers = [cycles, max(cycles, 500), max(cycles, 1000), 1500]
    # Remove duplicates and sort
    cycle_markers = sorted(list(set(cycle_markers)))
    
    for marker in cycle_markers:
        # Predict decay programmatically for curve rendering
        est_decay = min(15.0, (marker * 0.005) + max(0.0, (temp - 25) * 0.05))
        marker_soh = max(0.0, 100.0 - est_decay)
        decay_curve.append(
            ProjectedDecayPoint(
                cycles=marker,
                projected_soh=round(marker_soh, 3)
            )
        )
        
    return BatteryPredictionsResponse(
        battery_id=battery_id,
        predicted_soh=round(predicted_soh, 3),
        predicted_rul=predicted_rul,
        projected_decay_curve=decay_curve,
        inference_latency_ms=latency,
        timestamp=datetime.utcnow()
    )

@router.get(
    "/{battery_id}/recommendations",
    response_model=BatteryRecommendationsResponse,
    summary="Get actionable battery recommendations",
    description="Analyzes historical telemetry data to yield smart cell preservation rules."
)
async def get_battery_recommendations(
    battery_id: str,
    db: Session = Depends(get_session),
    current_user: User = Depends(get_current_user)
):
    # Fetch recent telemetry logs to perform stress evaluations
    statement = select(TelemetryRecord).where(TelemetryRecord.battery_id == battery_id).order_by(desc(TelemetryRecord.timestamp)).limit(20)
    history = db.exec(statement).all()
    
    recommendations = []
    warnings = []
    
    if not history:
        recommendations.append("Awaiting sufficient telemetry logs to generate preservation suggestions.")
        return BatteryRecommendationsResponse(
            battery_id=battery_id,
            recommendations=recommendations,
            warnings=warnings,
            timestamp=datetime.utcnow()
        )
        
    latest = history[0]
    
    # 1. Thermal stress analysis
    temps = [r.temperature for r in history]
    avg_temp = sum(temps) / len(temps)
    
    if avg_temp > 35.0:
        warnings.append(f"Cell temperature is elevated (recent average: {avg_temp:.1f}°C).")
        recommendations.append("Cooling phase recommended: Restrict fast charging current to prevent electrolyte breakdown.")
    
    # 2. Fast charging high current stress analysis
    currents = [r.current for r in history]
    max_charge_current = max(currents)
    
    if max_charge_current > 35.0:
        recommendations.append("Avoid continuous high-current fast charging when cell temperatures exceed 35°C.")
        
    # 3. Cycle and SOH capacity retention recommendations
    if latest.charge_cycles > 100:
        recommendations.append(
            f"Enabling the 80% charge limit is projected to extend the Remaining Useful Life from "
            f"{max(0, 1500 - latest.charge_cycles)} to {max(0, 1500 - latest.charge_cycles) + 450} cycles."
        )
        
    # 4. General OCV/chem balance suggestions
    recommendations.append("Transition into Constant-Voltage (CV) absorption phase earlier to reduce grid lattice stresses.")
    recommendations.append("Allow battery pack to cool down before initiating high-current charge cycles.")
    
    return BatteryRecommendationsResponse(
        battery_id=battery_id,
        recommendations=recommendations,
        warnings=warnings,
        timestamp=datetime.utcnow()
    )
