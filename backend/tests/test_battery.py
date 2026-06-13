import os
import sys
import time
from datetime import datetime

# Add parent directory to path to enable local module resolution
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from fastapi.testclient import TestClient
from sqlmodel import Session, select
from app.main import app
from app.db.database import engine, create_db_and_tables
from app.models.user import User
from app.models.telemetry import TelemetryRecord
from app.models.prediction import BatteryPrediction

client = TestClient(app)

def test_battery_endpoints_and_authentication():
    print("==================================================")
    # Ensure tables are built
    create_db_and_tables()
    
    # 1. Clean tables
    with Session(engine) as db:
        for record in db.exec(select(TelemetryRecord)).all():
            db.delete(record)
        for user in db.exec(select(User)).all():
            db.delete(user)
        for pred in db.exec(select(BatteryPrediction)).all():
            db.delete(pred)
        db.commit()

    print("[1] Registering and authenticating test user...")
    # Register owner
    reg_res = client.post(
        "/api/v1/auth/register",
        json={
            "email": "testowner@neurocharge.com",
            "password": "ownerpassword123",
            "full_name": "Battery Owner",
            "role": "owner"
        }
    )
    assert reg_res.status_code == 201

    # Login to obtain token
    login_res = client.post(
        "/api/v1/auth/login",
        data={
            "username": "testowner@neurocharge.com",
            "password": "ownerpassword123"
        }
    )
    assert login_res.status_code == 200
    token = login_res.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    battery_id = "TEST-BAT-999"

    print("\n[2] Testing Authentication Guard (should block GET requests without token)...")
    # Verify GET status is blocked
    res = client.get(f"/api/v1/battery/{battery_id}/status")
    assert res.status_code == 401
    
    # Verify GET health is blocked
    res = client.get(f"/api/v1/battery/{battery_id}/health")
    assert res.status_code == 401

    # Verify GET predictions is blocked
    res = client.get(f"/api/v1/battery/{battery_id}/predictions")
    assert res.status_code == 401

    # Verify GET recommendations is blocked
    res = client.get(f"/api/v1/battery/{battery_id}/recommendations")
    assert res.status_code == 401
    print("[OK] All endpoints blocked unauthenticated queries.")

    print("\n[3] Ingesting telemetry to seed status...")
    telemetry_payload = {
        "battery_id": battery_id,
        "voltage": 3.95,
        "current": 42.0,  # high current to trigger charge stress recommendations
        "temperature": 39.5,  # high temperature to trigger warnings
        "charging_state": "charging",
        "charge_cycles": 120,
        "ambient_temperature": 25.0
    }
    res = client.post("/api/v1/telemetry", json=telemetry_payload, headers=headers)
    assert res.status_code == 201
    
    # Sleep briefly to allow background thread to finish prediction calculation and DB insert
    print("Waiting 100ms for background SNN/LSTM prediction task...")
    time.sleep(0.1)

    print("\n[4] Querying GET /battery/{battery_id}/status...")
    res = client.get(f"/api/v1/battery/{battery_id}/status", headers=headers)
    assert res.status_code == 200
    data = res.json()
    assert data["battery_id"] == battery_id
    assert data["latest_telemetry"]["voltage"] == 3.95
    assert data["latest_telemetry"]["temperature"] == 39.5
    assert data["latest_telemetry"]["charge_cycles"] == 120
    print("[OK] Correct status retrieved.")

    print("\n[5] Querying GET /battery/{battery_id}/health...")
    res = client.get(f"/api/v1/battery/{battery_id}/health", headers=headers)
    assert res.status_code == 200
    data = res.json()
    assert data["battery_id"] == battery_id
    assert data["charge_cycles"] == 120
    assert "state_of_health" in data
    assert data["status"] in ["excellent", "good", "warning", "critical"]
    print(f"[OK] Correct health retrieved: SOH={data['state_of_health']}%, status={data['status']}")

    print("\n[6] Querying GET /battery/{battery_id}/predictions...")
    res = client.get(f"/api/v1/battery/{battery_id}/predictions", headers=headers)
    assert res.status_code == 200
    data = res.json()
    assert data["battery_id"] == battery_id
    assert len(data["projected_decay_curve"]) >= 2
    assert "predicted_soh" in data
    assert "predicted_rul" in data
    print(f"[OK] Correct predictions retrieved: RUL={data['predicted_rul']} cycles.")

    print("\n[7] Querying GET /battery/{battery_id}/recommendations...")
    res = client.get(f"/api/v1/battery/{battery_id}/recommendations", headers=headers)
    assert res.status_code == 200
    data = res.json()
    assert data["battery_id"] == battery_id
    assert len(data["recommendations"]) > 0
    # Since avg temp is > 35°C (we posted 39.5°C), warning should trigger
    assert len(data["warnings"]) > 0
    assert "elevated" in data["warnings"][0]
    print(f"[OK] Recommendations generated warnings successfully: {data['warnings']}")

    print("\nAll GET battery metrics tests completed successfully!")

if __name__ == "__main__":
    test_battery_endpoints_and_authentication()
