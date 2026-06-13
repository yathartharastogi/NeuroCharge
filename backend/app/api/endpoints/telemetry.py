import time
from datetime import datetime
from fastapi import APIRouter, BackgroundTasks, HTTPException, status, Depends
from sqlmodel import Session
from app.schemas.telemetry import TelemetryInput, TelemetryResponse
from app.services.encoder import event_encoder
from app.services.prediction import snn_detector, prediction_engine
from app.db.database import get_session
from app.models.telemetry import TelemetryRecord
from app.models.user import User
from app.api.deps import get_current_user

router = APIRouter()

@router.post(
    "/telemetry",
    response_model=TelemetryResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Ingest battery telemetry and generate neural spikes",
    description=(
        "Accepts continuous telemetry data (Voltage, Current, Temperature, Charging State, "
        "and Charge Cycles) from an EV battery. Converts these inputs into discrete neural spikes "
        "using delta-modulation, performs inline low-latency anomaly checks, saves the state to the "
        "database, and schedules long-term SOH/RUL predictions asynchronously."
    )
)
async def ingest_telemetry(
    payload: TelemetryInput,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_session),
    current_user: User = Depends(get_current_user)
):
    start_time = time.perf_counter()

    try:
        # 1. Convert continuous readings to discrete spikes via Delta-Modulation
        spikes = event_encoder.encode(
            battery_id=payload.battery_id,
            voltage=payload.voltage,
            current=payload.current,
            temperature=payload.temperature,
            charge_cycles=payload.charge_cycles
        )

        # 2. Perform inline neuromorphic anomaly detection (LIF Neuron integration)
        # This executes in <1ms, keeping request latency extremely low.
        thermal_anomaly = snn_detector.process_spikes(
            battery_id=payload.battery_id,
            spikes=spikes,
            telemetry=payload
        )

        # 3. Save the telemetry and spike record into the database
        db_record = TelemetryRecord(
            battery_id=payload.battery_id,
            voltage=payload.voltage,
            current=payload.current,
            temperature=payload.temperature,
            charging_state=payload.charging_state,
            charge_cycles=payload.charge_cycles,
            ambient_temperature=payload.ambient_temperature or 25.0,
            timestamp=payload.timestamp or datetime.utcnow(),
            voltage_spike=spikes.voltage,
            current_spike=spikes.current,
            temperature_spike=spikes.temperature,
            charge_cycles_spike=spikes.charge_cycles,
            thermal_anomaly_detected=thermal_anomaly
        )
        db.add(db_record)
        db.commit()
        db.refresh(db_record)

        # 4. Queue the heavy hybrid SNN + LSTM prediction model as a background task
        # This keeps the REST API responsive and optimized for low-latency ingest loops.
        prediction_triggered = False
        background_tasks.add_task(
            prediction_engine.run_long_term_degradation_inference,
            battery_id=payload.battery_id,
            telemetry=payload,
            spikes=spikes
        )
        prediction_triggered = True

        # Calculate final inline latency in milliseconds (includes DB insert time)
        latency_ms = (time.perf_counter() - start_time) * 1000.0

        return TelemetryResponse(
            battery_id=payload.battery_id,
            timestamp=payload.timestamp or datetime.utcnow(),
            spikes=spikes,
            thermal_anomaly_detected=thermal_anomaly,
            prediction_triggered=prediction_triggered,
            processing_latency_ms=latency_ms
        )

    except Exception as e:
        # Ensure we catch failures gracefully and do not hang the client
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Telemetry processing failed: {str(e)}"
        )
