import threading
from typing import Dict, Any, Tuple
from app.core.config import settings
from app.schemas.telemetry import SpikeOutput

class DeltaModulationEncoder:
    def __init__(self):
        # Maps battery_id to its last reference values: {battery_id: {"voltage": float, ...}}
        self._states: Dict[str, Dict[str, float]] = {}
        # Lock to ensure thread-safety for multi-threaded/async request handling
        self._lock = threading.Lock()

    def reset_state(self, battery_id: str):
        """Resets the state of a specific battery."""
        with self._lock:
            if battery_id in self._states:
                del self._states[battery_id]

    def encode(
        self,
        battery_id: str,
        voltage: float,
        current: float,
        temperature: float,
        charge_cycles: int
    ) -> SpikeOutput:
        """
        Converts continuous telemetry readings into discrete neural spikes.
        Uses reconstruction-based delta-modulation to track drift and avoid API bottlenecks.
        
        Spike definition:
         - 1: Value increased beyond the threshold (UP spike)
         - -1: Value decreased below the threshold (DOWN spike)
         - 0: Value stayed within the threshold (No spike)
        """
        with self._lock:
            # If battery state does not exist, initialize reference to current reading.
            # This prevents massive artificial spike bursts on first ingestion.
            if battery_id not in self._states:
                self._states[battery_id] = {
                    "voltage": voltage,
                    "current": current,
                    "temperature": temperature,
                    "charge_cycles": float(charge_cycles)
                }
                return SpikeOutput(
                    voltage=0,
                    current=0,
                    temperature=0,
                    charge_cycles=0
                )

            ref = self._states[battery_id]
            
            # 1. Voltage spike check
            voltage_delta = voltage - ref["voltage"]
            if voltage_delta >= settings.DELTA_THRESHOLD_VOLTAGE:
                v_spike = 1
                ref["voltage"] = voltage
            elif voltage_delta <= -settings.DELTA_THRESHOLD_VOLTAGE:
                v_spike = -1
                ref["voltage"] = voltage
            else:
                v_spike = 0

            # 2. Current spike check
            current_delta = current - ref["current"]
            if current_delta >= settings.DELTA_THRESHOLD_CURRENT:
                c_spike = 1
                ref["current"] = current
            elif current_delta <= -settings.DELTA_THRESHOLD_CURRENT:
                c_spike = -1
                ref["current"] = current
            else:
                c_spike = 0

            # 3. Temperature spike check
            temp_delta = temperature - ref["temperature"]
            if temp_delta >= settings.DELTA_THRESHOLD_TEMPERATURE:
                t_spike = 1
                ref["temperature"] = temperature
            elif temp_delta <= -settings.DELTA_THRESHOLD_TEMPERATURE:
                t_spike = -1
                ref["temperature"] = temperature
            else:
                t_spike = 0

            # 4. Charge cycles spike check (monotonically increasing)
            cycles_delta = float(charge_cycles) - ref["charge_cycles"]
            if cycles_delta >= settings.DELTA_THRESHOLD_CHARGE_CYCLES:
                cycles_spike = 1
                ref["charge_cycles"] = float(charge_cycles)
            else:
                cycles_spike = 0

            return SpikeOutput(
                voltage=v_spike,
                current=c_spike,
                temperature=t_spike,
                charge_cycles=cycles_spike
            )

# Singleton encoder instance to share state across requests
event_encoder = DeltaModulationEncoder()
