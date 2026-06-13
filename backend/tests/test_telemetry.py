import os
import sys
import time
import statistics
from datetime import datetime

# Add the backend folder to python path to run outside of standard modules
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from fastapi.testclient import TestClient
from sqlmodel import Session, select
from app.main import app
from app.db.database import engine, create_db_and_tables
from app.models.user import User
from app.models.telemetry import TelemetryRecord
from app.services.encoder import event_encoder
from app.services.prediction import snn_detector

client = TestClient(app)

def test_telemetry_correctness_and_latency():
    print("==================================================")
    print("   NEUROCHARGE ENDPOINT, DB & AUTH TEST SUITE    ")
    print("==================================================")

    # 1. Initialize clean database and tables
    create_db_and_tables()
    
    # Clean up any existing test records to guarantee deterministic test outcomes
    with Session(engine) as db:
        db.exec(select(TelemetryRecord)).all()
        # Clean users and telemetry records
        for record in db.exec(select(TelemetryRecord)).all():
            db.delete(record)
        for user in db.exec(select(User)).all():
            db.delete(user)
        db.commit()

    print("\n[1] Testing User Registration & Authentication Flow...")
    # Register owner user
    reg_response = client.post(
        "/api/v1/auth/register",
        json={
            "email": "owner@neurocharge.com",
            "password": "securepassword123",
            "full_name": "Tesla Owner",
            "role": "owner"
        }
    )
    assert reg_response.status_code == 201, f"Reg failed: {reg_response.text}"
    print("[OK] User registration succeeded.")

    # Register manager user
    reg_response_mgr = client.post(
        "/api/v1/auth/register",
        json={
            "email": "manager@neurocharge.com",
            "password": "securepassword123",
            "full_name": "Fleet Manager",
            "role": "manager"
        }
    )
    assert reg_response_mgr.status_code == 201
    
    # Login to obtain JWT Token
    login_response = client.post(
        "/api/v1/auth/login",
        data={
            "username": "owner@neurocharge.com",
            "password": "securepassword123"
        }
    )
    assert login_response.status_code == 200, f"Login failed: {login_response.text}"
    token_data = login_response.json()
    access_token = token_data["access_token"]
    auth_headers = {"Authorization": f"Bearer {access_token}"}
    print("[OK] User login succeeded. JWT token generated.")

    print("\n[2] Testing Authentication Guard (Unauthenticated block)...")
    battery_id = "TEST-BAT-002"
    payload = {
        "battery_id": battery_id,
        "voltage": 3.7,
        "current": 10.0,
        "temperature": 25.0,
        "charging_state": "charging",
        "charge_cycles": 10
    }
    
    # Send payload without Authorization header -> expect 401 Unauthorized
    no_auth_response = client.post("/api/v1/telemetry", json=payload)
    assert no_auth_response.status_code == 401
    print("[OK] Ingestion blocked for unauthenticated request.")

    print("\n[3] Testing Ingestion Initalizer (Authenticated)...")
    # Reset encoder/snn states for battery_id
    event_encoder.reset_state(battery_id)
    if battery_id in snn_detector._membrane_potentials:
        snn_detector._membrane_potentials[battery_id] = 0.0

    # Ingest baseline
    response = client.post("/api/v1/telemetry", json=payload, headers=auth_headers)
    assert response.status_code == 201, f"Ingest failed: {response.text}"
    data = response.json()
    assert data["spikes"]["voltage"] == 0
    assert data["spikes"]["current"] == 0
    assert data["spikes"]["temperature"] == 0
    assert data["spikes"]["charge_cycles"] == 0
    print("[OK] Baseline state initialized under authenticated session.")

    print("\n[4] Testing Spike Generation & LIF SNN Anomaly Detector...")
    # Make a large change to trigger temperature spikes
    # Trigger positive temperature spike (+0.3C)
    payload["temperature"] = 25.3
    response = client.post("/api/v1/telemetry", json=payload, headers=auth_headers)
    data = response.json()
    assert data["spikes"]["temperature"] == 1
    print("[OK] Temperature UP spike generated under authenticated session.")

    print("\n[5] Testing Database Persistence Verification...")
    # Check if telemetry is being persisted in the local SQLite db file
    with Session(engine) as db:
        records = db.exec(select(TelemetryRecord).where(TelemetryRecord.battery_id == battery_id)).all()
        assert len(records) == 2, f"Expected 2 database records, found {len(records)}"
        
        # Verify columns persist spikes correctly
        assert records[0].temperature_spike == 0  # baseline
        assert records[1].temperature_spike == 1  # spike reading
        print(f"[OK] Database persistence verified. Found {len(records)} records in SQL storage.")

    print("\n[6] Running Latency & DB persistence benchmark (100 sequential requests)...")
    latencies = []
    
    # Feed 100 requests to measure uvicorn + DB commit + SNN speed under authenticated session
    for i in range(100):
        test_payload = {
            "battery_id": f"PERF-BAT-{i % 5}",
            "voltage": 3.7 + (i * 0.001),
            "current": 10.0 + (i * 0.01),
            "temperature": 25.0 + (i * 0.05),
            "charging_state": "charging" if i % 2 == 0 else "idle",
            "charge_cycles": 10 + (i // 10)
        }
        start = time.perf_counter()
        response = client.post("/api/v1/telemetry", json=test_payload, headers=auth_headers)
        end = time.perf_counter()
        
        assert response.status_code == 201
        latencies.append((end - start) * 1000.0)

    # Calculate statistics
    avg_latency = statistics.mean(latencies)
    min_latency = min(latencies)
    max_latency = max(latencies)
    sorted_latencies = sorted(latencies)
    p50 = sorted_latencies[50]
    p90 = sorted_latencies[90]
    p99 = sorted_latencies[99]

    print(f"\n================ BENCHMARK STATISTICS ================")
    print(f"  Total Requests:  100")
    print(f"  Min Latency:     {min_latency:.3f} ms")
    print(f"  Max Latency:     {max_latency:.3f} ms")
    print(f"  Average Latency: {avg_latency:.3f} ms (includes database commit)")
    print(f"  p50 (Median):    {p50:.3f} ms")
    print(f"  p90 Latency:     {p90:.3f} ms")
    print(f"  p99 Latency:     {p99:.3f} ms")
    print(f"======================================================")

    # Assert p99 latency remains well under the 500ms target
    assert p99 < 500.0, f"Latency benchmark failed: p99 latency {p99:.2f}ms exceeds 500ms limit!"
    print("[OK] Latency SLA requirements satisfied (<500ms limit).")
    print("\nAll database, security, and performance tests passed successfully!")

if __name__ == "__main__":
    test_telemetry_correctness_and_latency()
