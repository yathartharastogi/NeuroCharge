import time
import json
import math
import random
import argparse
import urllib.request
import urllib.error
from datetime import datetime

class BatterySimulator:
    def __init__(self, battery_id: str, ambient_temp: float = 25.0, runaway: bool = False):
        self.battery_id = battery_id
        self.ambient_temp = ambient_temp
        self.runaway = runaway
        
        # Cell Constants
        self.capacity_ah = 100.0        # 100 Ah total capacity
        self.internal_resistance = 0.015 # 15 mOhms
        self.heat_capacity = 850.0      # Joules per Celsius (Thermal Mass)
        self.convection_coeff = 0.45    # Watts per Celsius (heat dissipation)
        
        # Dynamic States
        self.soc = 55.0                 # State of Charge (percent, 0 to 100)
        self.temperature = ambient_temp # Starting temperature
        self.charge_cycles = 180
        self.charging_state = "idle"
        self.current = 0.0
        self.voltage = 3.7
        self.ah_throughput = 0.0        # Cumulative Ah to track cycle completion

        # Simulation settings
        self.time_step = 1.0            # 1 second intervals
        self.step_count = 0

    def step(self):
        self.step_count += 1
        
        # 1. State machine to switch states dynamically if not idle/constant
        if not self.runaway:
            # Cycle through States for visual interest
            if self.step_count % 30 == 1:
                # Alternate between charging, discharging, and idle
                states = ["charging", "discharging", "idle"]
                self.charging_state = states[(self.step_count // 30) % 3]

            if self.charging_state == "charging":
                # Constant Current (CC) charging at 25A with some noise
                self.current = 25.0 + random.uniform(-0.5, 0.5)
                # SOC increases
                self.soc += (self.current * self.time_step / 3600.0) / self.capacity_ah * 100.0
                if self.soc >= 98.0:
                    self.soc = 98.0
                    self.charging_state = "idle"
            elif self.charging_state == "discharging":
                # Discharging at variable load (average -18A)
                self.current = -18.0 + random.uniform(-2.0, 2.0)
                # SOC decreases
                self.soc += (self.current * self.time_step / 3600.0) / self.capacity_ah * 100.0
                if self.soc <= 5.0:
                    self.soc = 5.0
                    self.charging_state = "charging"
            else:
                # Idle state
                self.current = 0.0
                # Minor self-discharge
                self.soc -= 0.00001
        else:
            # Thermal runaway simulation mode:
            # Rapid high-rate charging to stress the cell, plus exponential heating
            self.charging_state = "charging"
            self.current = 45.0 + random.uniform(-1.0, 1.0)
            self.soc += (self.current * self.time_step / 3600.0) / self.capacity_ah * 100.0
            self.soc = min(100.0, self.soc)

        # Track Ah throughput to increment cycles
        # A full cycle is defined as charging/discharging the nominal capacity
        self.ah_throughput += abs(self.current) * self.time_step / 3600.0
        if self.ah_throughput >= self.capacity_ah:
            self.charge_cycles += 1
            self.ah_throughput -= self.capacity_ah

        # 2. Physics-based Open Circuit Voltage (OCV) curve vs State of Charge (SOC)
        # Empirical equation representing a Lithium Iron Phosphate (LFP) cell profile
        soc_ratio = self.soc / 100.0
        ocv = 3.1 + 0.8 * soc_ratio + 0.1 * math.log(max(soc_ratio, 0.001)) - 0.05 * math.exp(-20.0 * soc_ratio)
        ocv = max(2.8, min(4.2, ocv))

        # Terminal Voltage = OCV + I * R_int
        self.voltage = ocv + (self.current * self.internal_resistance)
        self.voltage = max(2.5, min(4.35, self.voltage))

        # 3. Physics-based Thermal Dynamics
        # Joule heating: Q_gen = I^2 * R
        heat_gen = (self.current ** 2) * self.internal_resistance
        # Convection loss: Q_loss = h * (T_cell - T_amb)
        heat_loss = self.convection_coeff * (self.temperature - self.ambient_temp)
        
        # Heat balance: dT = (Q_gen - Q_loss) / C_p
        dT = (heat_gen - heat_loss) / self.heat_capacity * self.time_step
        
        # Apply runaway thermal component if flagged
        if self.runaway:
            # Simulate chemical breakdown heating (runaway accelerates above 40C)
            runaway_factor = max(0.5, (self.temperature - 30.0) * 0.15) if self.temperature > 30.0 else 0.5
            dT += runaway_factor * 1.8 * self.time_step
            
        self.temperature += dT
        # Keep within physically bounds
        self.temperature = max(-20.0, min(150.0, self.temperature))

    def get_telemetry_payload(self) -> dict:
        return {
            "battery_id": self.battery_id,
            "voltage": round(self.voltage, 3),
            "current": round(self.current, 2),
            "temperature": round(self.temperature, 2),
            "charging_state": self.charging_state,
            "charge_cycles": int(self.charge_cycles),
            "ambient_temperature": round(self.ambient_temp, 2)
        }

def run_simulation(endpoint_url: str, battery_id: str, interval: float, runaway: bool):
    print("==================================================")
    print("      NEUROCHARGE TELEMETRY PHYSICS SIMULATOR     ")
    print(f"      Target: {endpoint_url}")
    print(f"      Battery: {battery_id} (Runaway: {runaway})")
    print("==================================================")
    
    sim = BatterySimulator(battery_id=battery_id, runaway=runaway)
    
    while True:
        sim.step()
        payload = sim.get_telemetry_payload()
        
        # Log to simulator terminal
        status_line = (
            f"Step: {sim.step_count:03d} | "
            f"State: {payload['charging_state']:11} | "
            f"V: {payload['voltage']:.3f}V | "
            f"I: {payload['current']:6.2f}A | "
            f"T: {payload['temperature']:5.2f} C | "
            f"Cycles: {payload['charge_cycles']}"
        )
        print(status_line)
        
        # POST telemetry to FastAPI server
        req = urllib.request.Request(
            endpoint_url,
            data=json.dumps(payload).encode('utf-8'),
            headers={'Content-Type': 'application/json'}
        )
        
        try:
            with urllib.request.urlopen(req, timeout=2.0) as response:
                res_body = json.loads(response.read().decode('utf-8'))
                
                # Check response spikes and warnings
                spikes = res_body.get("spikes", {})
                anomaly = res_body.get("thermal_anomaly_detected", False)
                latency = res_body.get("processing_latency_ms", 0.0)
                
                spike_str = []
                if spikes.get("voltage") != 0: spike_str.append(f"V:{'+' if spikes['voltage']>0 else '-'}")
                if spikes.get("current") != 0: spike_str.append(f"I:{'+' if spikes['current']>0 else '-'}")
                if spikes.get("temperature") != 0: spike_str.append(f"T:{'+' if spikes['temperature']>0 else '-'}")
                if spikes.get("charge_cycles") != 0: spike_str.append("Cycle:*")
                
                spike_msg = ", ".join(spike_str) if spike_str else "None"
                
                print(f"  --> [API Resp] Latency: {latency:.2f}ms | Neural Spikes: {spike_msg}")
                if anomaly:
                    print("  [ALERT] !!! SNN ANOMALY DETECTED BY ENGINE !!!")
                    
        except urllib.error.URLError as e:
            print(f"  --> [Connection Error] Backend unreachable at {endpoint_url}. Is FastAPI running?")
            
        time.sleep(interval)

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Simulate real-time EV Battery telemetry inputs.")
    parser.add_argument("--url", default="http://localhost:8000/api/v1/telemetry", help="Target URL endpoint")
    parser.add_argument("--id", default="BAT-NEURO-901", help="Battery identifier")
    parser.add_argument("--interval", type=float, default=1.0, help="Sim intervals in seconds")
    parser.add_argument("--runaway", action="store_true", help="Simulate critical runaway event")
    
    args = parser.parse_args()
    try:
        run_simulation(args.url, args.id, args.interval, args.runaway)
    except KeyboardInterrupt:
        print("\nSimulation terminated by user.")
