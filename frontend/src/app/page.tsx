"use client";

import React, { useState, useEffect, useRef } from "react";

// Types
type Tab = "realtime" | "predictive" | "recommendations";
type ChargingState = "charging" | "discharging" | "idle";

interface SpikeEvent {
  time: string;
  voltage: number; // -1, 0, 1
  current: number;
  temperature: number;
  chargeCycles: number;
}

interface AlertLog {
  id: string;
  timestamp: string;
  type: "warning" | "danger" | "info";
  message: string;
}

export default function Home() {
  const [activeTab, setActiveTab] = useState<Tab>("realtime");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);
  
  // Interactive Simulation Controls
  const [chargingState, setChargingState] = useState<ChargingState>("charging");
  const [fastCharge, setFastCharge] = useState(false);
  const [chargeLimit80, setChargeLimit80] = useState(false);
  const [runawayMode, setRunawayMode] = useState(false);

  // Simulated Battery Dynamic States
  const [soc, setSoc] = useState(55.0);
  const [temperature, setTemperature] = useState(26.2);
  const [voltage, setVoltage] = useState(3.82);
  const [current, setCurrent] = useState(25.0);
  const [chargeCycles, setChargeCycles] = useState(180);
  const [soh, setSoh] = useState(99.15);
  const [rul, setRul] = useState(1320);

  // Digital Twin Parallel Ideal States
  const [twinTemp, setTwinTemp] = useState(25.4);
  const [twinVoltage, setTwinVoltage] = useState(3.85);

  // SNN LIF (Leaky Integrate-and-Fire) State
  const [membranePotential, setMembranePotential] = useState(0.0);
  const [vThreshold] = useState(1.0);
  const [vRest] = useState(0.0);
  const [tau] = useState(4.0); // Leak constant

  // Event Encoder Reference Values (Delta-Modulation)
  const refVoltage = useRef(3.82);
  const refCurrent = useRef(25.0);
  const refTemperature = useRef(26.2);
  const refCycles = useRef(180);

  // Logs & History Tracking
  const [spikesHistory, setSpikesHistory] = useState<SpikeEvent[]>([]);
  const [alerts, setAlerts] = useState<AlertLog[]>([
    {
      id: "init",
      timestamp: new Date().toLocaleTimeString(),
      type: "info",
      message: "NeuroCharge SNN engine initialized. Reference baselines calibrated."
    }
  ]);

  // AI Assistant QA State
  const [selectedQA, setSelectedQA] = useState<number | null>(null);

  // Full-Stack Ingestion & Connection States
  const [connectToAPI, setConnectToAPI] = useState(false);
  const [apiToken, setApiToken] = useState<string | null>(null);
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [serverLatency, setServerLatency] = useState<number | null>(null);
  const [networkLatency, setNetworkLatency] = useState<number | null>(null);
  const [connectionError, setConnectionError] = useState(false);

  // 1. Authenticate with seeded credentials when API Connection is toggled on
  useEffect(() => {
    if (!connectToAPI) {
      setApiToken(null);
      setServerLatency(null);
      setNetworkLatency(null);
      setConnectionError(false);
      return;
    }

    const authenticate = async () => {
      setIsAuthenticating(true);
      setConnectionError(false);
      
      // OAuth2 request expects application/x-www-form-urlencoded format
      const formData = new URLSearchParams();
      formData.append("username", "admin@neurocharge.com");
      formData.append("password", "adminpassword123");

      try {
        const response = await fetch("http://127.0.0.1:8000/api/v1/auth/login", {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: formData,
        });

        if (!response.ok) {
          throw new Error("Authentication failed");
        }

        const data = await response.json();
        setApiToken(data.access_token);
        addAlert("info", "Authenticated with backend. Secure streaming link established.");
      } catch (err) {
        console.error(err);
        setConnectionError(true);
        setConnectToAPI(false);
        addAlert("warning", "Connection failed. Please ensure the FastAPI server is running on port 8000.");
      } finally {
        setIsAuthenticating(false);
      }
    };

    authenticate();
  }, [connectToAPI]);

  // 2. Main Simulation & Streaming Loop: runs every 1.5 seconds
  useEffect(() => {
    const interval = setInterval(async () => {
      // Step Variables
      let nextState = chargingState;
      let nextCurrent = current;
      let nextSoc = soc;
      let nextTemp = temperature;
      let nextCycles = chargeCycles;
      
      // Calculate Current based on toggles
      if (runawayMode) {
        nextState = "charging";
        nextCurrent = 48.5 + Math.random(); // Severe current stress
      } else if (chargingState === "charging") {
        nextCurrent = fastCharge ? 40.0 : 20.0;
        nextCurrent += (Math.random() - 0.5) * 0.8;
      } else if (chargingState === "discharging") {
        nextCurrent = -15.0 - (Math.random() * 5); // Discharge load
      } else {
        nextCurrent = 0.0;
      }

      // Calculate SOC updates (CC/CV simulation)
      if (nextState === "charging") {
        nextSoc += (nextCurrent * 1.5) / 3600.0 / 100.0 * 100.0;
        if (chargeLimit80 && nextSoc >= 80.0) {
          nextSoc = 80.0;
          setChargingState("idle");
          addAlert("info", "Charge target reached: 80% charging cap triggered.");
        } else if (nextSoc >= 99.5) {
          nextSoc = 99.5;
          setChargingState("idle");
          addAlert("info", "Battery fully charged. Switched to idle mode.");
        }
      } else if (nextState === "discharging") {
        nextSoc += (nextCurrent * 1.5) / 3600.0 / 100.0 * 100.0;
        if (nextSoc <= 5.0) {
          nextSoc = 5.0;
          setChargingState("idle");
          addAlert("warning", "Battery low: discharging terminated.");
        }
      }

      // Physics OCV-SOC mapping
      const socRatio = nextSoc / 100.0;
      const ocv = 3.2 + 0.8 * socRatio - 0.04 * Math.exp(-15 * socRatio);
      let nextVoltage = ocv + (nextCurrent * 0.012); // R_int = 12mOhm
      nextVoltage = Math.max(2.8, Math.min(4.25, nextVoltage));

      // Thermal Dynamics (Joule Heating + Surroundings Convection)
      const ambientTemp = 24.5;
      const heatGen = (nextCurrent ** 2) * 0.012; // I^2 * R
      const heatLoss = 0.35 * (nextTemp - ambientTemp); // h * dT
      let dT = (heatGen - heatLoss) / 780.0 * 1.5; // C_p = 780J/C

      // Apply runaway thermal multiplier
      if (runawayMode) {
        const runawayMultiplier = nextTemp > 35.0 ? (nextTemp - 30.0) * 0.25 : 0.6;
        dT += runawayMultiplier * 3.5;
      }
      nextTemp += dT;

      // Charge Cycles increment throughput tracking
      const stepThroughput = (Math.abs(nextCurrent) * 1.5) / 3600.0;
      if (stepThroughput > 0.005) {
        if (Math.random() < 0.05) {
          nextCycles += 1;
        }
      }

      // Update basic states
      setSoc(Number(nextSoc.toFixed(2)));
      setVoltage(Number(nextVoltage.toFixed(3)));
      setCurrent(Number(nextCurrent.toFixed(2)));
      setTemperature(Number(nextTemp.toFixed(2)));
      setChargeCycles(nextCycles);

      // Digital Twin dynamics
      setTwinTemp(ambientTemp + (heatGen - 0.35 * (twinTemp - ambientTemp)) / 780.0 * 1.5);
      setTwinVoltage(ocv + (nextCurrent * 0.008)); // Ideal battery has lower resistance

      // SOH / RUL predictions simulation based on stress factors
      const cycleStress = nextCycles * 0.0045;
      const tempStress = nextTemp > 38.0 ? (nextTemp - 35) * 0.08 : 0.0;
      const calculatedSoh = Math.max(70.0, 100.0 - cycleStress - tempStress);
      setSoh(Number(calculatedSoh.toFixed(3)));

      const estimatedRul = Math.max(0, Math.round(1500 - nextCycles - (tempStress * 250)));
      setRul(estimatedRul);

      // 3. TELEMETRY STREAMING: DECIDE LIVE API VS LOCAL SIMULATION
      if (connectToAPI && apiToken) {
        // Stream telemetry to backend FastAPI server
        const payload = {
          battery_id: "BAT-NEURO-901",
          voltage: Number(nextVoltage.toFixed(3)),
          current: Number(nextCurrent.toFixed(2)),
          temperature: Number(nextTemp.toFixed(2)),
          charging_state: nextState,
          charge_cycles: nextCycles,
          ambient_temperature: ambientTemp,
        };

        const postStart = Date.now();
        try {
          const res = await fetch("http://127.0.0.1:8000/api/v1/telemetry", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${apiToken}`,
            },
            body: jsonStringifySafe(payload),
          });

          if (!res.ok) {
            if (res.status === 401) {
              setApiToken(null);
              setConnectToAPI(false);
              addAlert("warning", "Token expired. Please reconnect.");
              return;
            }
            throw new Error("Ingestion error");
          }

          const resData = await res.json();
          const postEnd = Date.now();

          // Latency Metrics
          setServerLatency(resData.processing_latency_ms);
          setNetworkLatency(postEnd - postStart);

          // Spikes returned from server
          const spikes = resData.spikes;
          const sV = spikes.voltage;
          const sI = spikes.current;
          const sT = spikes.temperature;
          const sC = spikes.charge_cycles;

          if (sV !== 0 || sI !== 0 || sT !== 0 || sC !== 0) {
            setSpikesHistory((prev) => [
              {
                time: new Date().toLocaleTimeString(),
                voltage: sV,
                current: sI,
                temperature: sT,
                chargeCycles: sC,
              },
              ...prev.slice(0, 19),
            ]);
          }

          // Anomaly checks from server
          if (resData.thermal_anomaly_detected) {
            addAlert("danger", "CRITICAL ALERT (API): SNN Anomaly Detected! Rapid cell temperature elevation and current imbalance. Battery shutoff recommended.");
          }
        } catch (err) {
          console.error(err);
          setConnectToAPI(false);
          addAlert("warning", "Connection lost. API server was shut down.");
        }
      } else {
        // Run Local Browser Simulation Mode
        const dV_thresh = 0.05;
        const dI_thresh = 0.8;
        const dT_thresh = 0.20;

        let sV = 0;
        let sI = 0;
        let sT = 0;
        let sC = 0;

        const diffV = nextVoltage - refVoltage.current;
        if (diffV >= dV_thresh) { sV = 1; refVoltage.current = nextVoltage; }
        else if (diffV <= -dV_thresh) { sV = -1; refVoltage.current = nextVoltage; }

        const diffI = nextCurrent - refCurrent.current;
        if (diffI >= dI_thresh) { sI = 1; refCurrent.current = nextCurrent; }
        else if (diffI <= -dI_thresh) { sI = -1; refCurrent.current = nextCurrent; }

        const diffT = nextTemp - refTemperature.current;
        if (diffT >= dT_thresh) { sT = 1; refTemperature.current = nextTemp; }
        else if (diffT <= -dT_thresh) { sT = -1; refTemperature.current = nextTemp; }

        if (nextCycles - refCycles.current >= 1) { sC = 1; refCycles.current = nextCycles; }

        const hasSpikes = sV !== 0 || sI !== 0 || sT !== 0 || sC !== 0;
        if (hasSpikes) {
          setSpikesHistory((prev) => [
            {
              time: new Date().toLocaleTimeString(),
              voltage: sV,
              current: sI,
              temperature: sT,
              chargeCycles: sC,
            },
            ...prev.slice(0, 19),
          ]);
        }

        // Run local LIF simulation
        let v_m = membranePotential;
        v_m = v_m - (v_m - vRest) / tau;
        const inputTempSpike = sT > 0 ? 1.0 : 0.0;
        const inputCurrSpike = sI > 0 ? 1.0 : 0.0;
        v_m += (0.55 * inputTempSpike) + (0.25 * inputCurrSpike);

        if (nextTemp > 45.0) v_m += 0.4;
        if (nextTemp > 55.0) v_m = vThreshold + 0.1;

        if (v_m >= vThreshold) {
          v_m = vRest;
          addAlert("danger", "CRITICAL ALERT (Local): SNN Anomaly Detected! Rapid cell temperature elevation and current imbalance. Battery shutoff recommended.");
        }
        setMembranePotential(Number(v_m.toFixed(3)));
      }

    }, 1500);

    return () => clearInterval(interval);
  }, [soc, temperature, voltage, current, chargeCycles, membranePotential, chargingState, fastCharge, chargeLimit80, runawayMode, twinTemp, twinVoltage, connectToAPI, apiToken]);

  // Helper safety JSON stringify for payload
  const jsonStringifySafe = (obj: any): string => {
    return JSON.stringify(obj);
  };

  const addAlert = (type: "warning" | "danger" | "info", message: string) => {
    setAlerts((prev) => [
      {
        id: Math.random().toString(),
        timestamp: new Date().toLocaleTimeString(),
        type,
        message
      },
      ...prev.slice(0, 14)
    ]);
  };

  const handleReset = () => {
    setTemperature(26.2);
    setSoc(55.0);
    setVoltage(3.82);
    setCurrent(25.0);
    setRunawayMode(false);
    setChargingState("idle");
    setMembranePotential(0.0);
    refVoltage.current = 3.82;
    refCurrent.current = 25.0;
    refTemperature.current = 26.2;
    setSpikesHistory([]);
    addAlert("info", "Battery parameters and SNN detector recalibrated.");
  };

  const qaData = [
    {
      q: "What is delta-modulation event encoding?",
      a: "Delta-modulation converts continuous signals into discrete events (spikes). When a continuous parameter (e.g. Temperature) changes from its last reference level by more than a pre-defined threshold, it generates an UP (+1) or DOWN (-1) event and updates its reference. This mimics biological sensory receptors, minimizing data processing overhead and lowering latency to <5ms."
    },
    {
      q: "How does the Leaky Integrate-and-Fire (LIF) model detect anomalies?",
      a: "The LIF model simulates the membrane potential of a biological neuron. It continuously integrates incoming event spikes (representing temperature rise, current surges, etc.) while slowly leaking potential over time. If a flurry of warning spikes arrives within a short window, the potential accumulates and crosses a threshold, instantly firing an anomaly trigger. If spikes are scattered and slow, they leak away safely without triggering alerts."
    },
    {
      q: "Why does fast charging accelerate battery degradation?",
      a: "Fast charging pushes higher currents into the cell, generating substantial Joule heating (heat proportional to Current squared). High temperatures accelerate chemical degradation mechanisms like lithium plating, solid electrolyte interphase (SEI) layer growth, and mechanical cell cracking. Limiting fast charging extends cell cycle life considerably."
    }
  ];

  return (
    <div className="flex flex-1 min-h-screen bg-background text-foreground transition-colors duration-300">
      
      {/* SIDEBAR NAVIGATION */}
      <aside className="w-64 border-r border-card-border bg-card p-6 flex flex-col justify-between hidden md:flex">
        <div>
          {/* Platform Title */}
          <div className="flex items-center gap-3 mb-8">
            <div className="h-8 w-8 rounded-full bg-primary flex items-center justify-center text-primary-foreground font-bold text-sm tracking-wider">
              NC
            </div>
            <div>
              <h1 className="font-bold text-lg leading-tight tracking-tight">NeuroCharge</h1>
              <span className="text-xs text-muted font-medium uppercase tracking-widest">SNN Platform</span>
            </div>
          </div>

          {/* Navigation Links */}
          <nav className="space-y-1">
            <button
              onClick={() => setActiveTab("realtime")}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-all ${
                activeTab === "realtime"
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted hover:bg-muted-light hover:text-foreground"
              }`}
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
              Live Monitor
            </button>
            <button
              onClick={() => setActiveTab("predictive")}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-all ${
                activeTab === "predictive"
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted hover:bg-muted-light hover:text-foreground"
              }`}
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Predictive Twin
            </button>
            <button
              onClick={() => setActiveTab("recommendations")}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-all ${
                activeTab === "recommendations"
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted hover:bg-muted-light hover:text-foreground"
              }`}
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
              </svg>
              AI Preservation
            </button>
          </nav>

          {/* LIVE API CONNECTION TOGGLE */}
          <div className="mt-8 pt-6 border-t border-card-border space-y-3">
            <span className="text-2xs font-bold uppercase tracking-widest text-muted block">Database Integration</span>
            <div className="flex items-center justify-between bg-muted-light p-3.5 rounded-xl">
              <div className="space-y-0.5">
                <span className="text-xs font-semibold block">Live API link</span>
                <span className="text-3xs text-muted block">Persist records to SQL</span>
              </div>
              <input
                type="checkbox"
                checked={connectToAPI}
                disabled={isAuthenticating}
                onChange={(e) => setConnectToAPI(e.target.checked)}
                className="h-4 w-4 text-primary focus:ring-primary border-card-border rounded"
              />
            </div>
            {isAuthenticating && (
              <span className="text-3xs text-accent block animate-pulse font-semibold">Authenticating admin session...</span>
            )}
            {connectionError && (
              <span className="text-3xs text-danger block font-semibold">Connection failed: API down?</span>
            )}
          </div>
        </div>

        {/* System Status Indicators */}
        <div className="bg-muted-light rounded-xl p-4 text-xs space-y-3">
          <div className="flex justify-between items-center">
            <span className="text-muted">Link Connection:</span>
            <span className={`font-semibold flex items-center gap-1 ${connectToAPI ? 'text-success' : 'text-accent'}`}>
              <span className={`h-1.5 w-1.5 rounded-full bg-current ${connectToAPI ? 'animate-pulse' : ''}`}></span>
              {connectToAPI ? "API Streaming" : "Local Sim"}
            </span>
          </div>
          {connectToAPI && (
            <>
              <div className="flex justify-between items-center text-3xs font-mono">
                <span className="text-muted">API Latency:</span>
                <span>{serverLatency !== null ? `${serverLatency.toFixed(2)}ms` : "checking..."}</span>
              </div>
              <div className="flex justify-between items-center text-3xs font-mono">
                <span className="text-muted">Roundtrip Lag:</span>
                <span>{networkLatency !== null ? `${networkLatency}ms` : "checking..."}</span>
              </div>
            </>
          )}
          <div className="flex justify-between items-center">
            <span className="text-muted">SNN Model:</span>
            <span className="font-semibold text-primary">LIF-Thermal v1</span>
          </div>
        </div>
      </aside>

      {/* MAIN CONTENT AREA */}
      <main className="flex-1 flex flex-col p-4 md:p-8 space-y-6 overflow-y-auto">
        
        {/* HEADER BAR */}
        <header className="flex justify-between items-center border-b border-card-border pb-4">
          <div>
            <h2 className="text-2xl font-bold tracking-tight">EV Battery Intelligence</h2>
            <p className="text-sm text-muted">Real-time neuromorphic analytics for LFP Battery Pack <code>BAT-NEURO-901</code></p>
          </div>
          
          <div className="flex items-center gap-3">
            {runawayMode && (
              <span className="bg-danger text-white px-3 py-1 rounded-full text-xs font-semibold uppercase animate-pulse">
                Runaway Active
              </span>
            )}
            <button
              onClick={handleReset}
              className="px-4 py-2 border border-card-border bg-card rounded-lg hover:bg-muted-light transition-all text-xs font-semibold shadow-sm"
            >
              Reset Simulation
            </button>
          </div>
        </header>

        {/* TAB NAVIGATION FOR MOBILE */}
        <div className="flex md:hidden border border-card-border rounded-lg bg-card overflow-hidden">
          <button
            onClick={() => setActiveTab("realtime")}
            className={`flex-1 py-3 text-xs font-semibold ${activeTab === 'realtime' ? 'bg-primary text-primary-foreground' : 'text-muted'}`}
          >
            Live Monitor
          </button>
          <button
            onClick={() => setActiveTab("predictive")}
            className={`flex-1 py-3 text-xs font-semibold ${activeTab === 'predictive' ? 'bg-primary text-primary-foreground' : 'text-muted'}`}
          >
            Predictive Twin
          </button>
          <button
            onClick={() => setActiveTab("recommendations")}
            className={`flex-1 py-3 text-xs font-semibold ${activeTab === 'recommendations' ? 'bg-primary text-primary-foreground' : 'text-muted'}`}
          >
            AI Preservation
          </button>
        </div>

        {/* GRID LAYOUT FOR REALTIME CONTENT */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          
          {/* COLUMN 1 & 2: PRIMARY VIEW CONTENT */}
          <div className="lg:col-span-2 space-y-6">
            
            {/* VIEW 1: LIVE REAL-TIME MONITOR */}
            {activeTab === "realtime" && (
              <div className="space-y-6">
                
                {/* 2X3 STATS GRID */}
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                  
                  {/* SOC Card */}
                  <div className="bg-card border border-card-border rounded-2xl p-5 hover:-translate-y-0.5 transition-all duration-200 shadow-sm relative overflow-hidden">
                    <span className="text-xs text-muted font-bold uppercase tracking-wider block mb-1">State of Charge</span>
                    <div className="flex items-baseline gap-1 mt-2">
                      <span className="text-3xl font-extrabold tracking-tight">{soc}%</span>
                    </div>
                    {/* SOC progress indicator bar */}
                    <div className="w-full bg-muted-light h-1.5 rounded-full mt-4 overflow-hidden">
                      <div
                        className="bg-primary h-full transition-all duration-500"
                        style={{ width: `${soc}%` }}
                      ></div>
                    </div>
                  </div>

                  {/* Temperature Card */}
                  <div className={`bg-card border rounded-2xl p-5 hover:-translate-y-0.5 transition-all duration-200 shadow-sm ${temperature > 40 ? 'border-danger' : 'border-card-border'}`}>
                    <span className="text-xs text-muted font-bold uppercase tracking-wider block mb-1">Cell Temp</span>
                    <div className="flex items-baseline gap-1 mt-2">
                      <span className={`text-3xl font-extrabold tracking-tight ${temperature > 40 ? 'text-danger' : ''}`}>{temperature}°C</span>
                    </div>
                    <span className="text-xs text-muted mt-2 block">
                      {runawayMode ? "Critical Rising" : temperature > 32 ? "Warning Threshold" : "Thermal Stable"}
                    </span>
                  </div>

                  {/* Voltage Card */}
                  <div className="bg-card border border-card-border rounded-2xl p-5 hover:-translate-y-0.5 transition-all duration-200 shadow-sm">
                    <span className="text-xs text-muted font-bold uppercase tracking-wider block mb-1">Terminal Voltage</span>
                    <div className="flex items-baseline gap-1 mt-2">
                      <span className="text-3xl font-extrabold tracking-tight">{voltage}V</span>
                    </div>
                    <span className="text-xs text-muted mt-2 block">Cell limit: 4.2V</span>
                  </div>

                  {/* Current Card */}
                  <div className="bg-card border border-card-border rounded-2xl p-5 hover:-translate-y-0.5 transition-all duration-200 shadow-sm">
                    <span className="text-xs text-muted font-bold uppercase tracking-wider block mb-1">Current Draw</span>
                    <div className="flex items-baseline gap-1 mt-2">
                      <span className={`text-3xl font-extrabold tracking-tight ${current > 0 ? 'text-success' : current < 0 ? 'text-accent' : ''}`}>
                        {current > 0 ? `+${current}` : current}A
                      </span>
                    </div>
                    <span className="text-xs text-muted mt-2 block">
                      {current > 0 ? "Fast Charging" : current < 0 ? "Discharging Load" : "Idle Static"}
                    </span>
                  </div>

                  {/* SOH Card */}
                  <div className="bg-card border border-card-border rounded-2xl p-5 hover:-translate-y-0.5 transition-all duration-200 shadow-sm">
                    <span className="text-xs text-muted font-bold uppercase tracking-wider block mb-1">Predicted SOH</span>
                    <div className="flex items-baseline gap-1 mt-2">
                      <span className="text-3xl font-extrabold tracking-tight">{soh}%</span>
                    </div>
                    <span className="text-xs text-muted mt-2 block">Capacity retention</span>
                  </div>

                  {/* Cycles Card */}
                  <div className="bg-card border border-card-border rounded-2xl p-5 hover:-translate-y-0.5 transition-all duration-200 shadow-sm">
                    <span className="text-xs text-muted font-bold uppercase tracking-wider block mb-1">RUL Projection</span>
                    <div className="flex items-baseline gap-1 mt-2">
                      <span className="text-3xl font-extrabold tracking-tight">{rul} cycles</span>
                    </div>
                    <span className="text-xs text-muted mt-2 block">Cycle life remaining</span>
                  </div>

                </div>

                {/* PHYSICAL SIMULATION CONTROL CENTER */}
                <div className="bg-card border border-card-border rounded-2xl p-6 shadow-sm">
                  <h3 className="text-base font-bold mb-4 flex items-center gap-2">
                    <svg className="w-5 h-5 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                    Cell Simulation Control Center
                  </h3>
                  
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
                    
                    {/* Toggle State */}
                    <div className="p-4 bg-muted-light rounded-xl space-y-2">
                      <label className="text-xs text-muted uppercase font-bold tracking-wider">Charging State</label>
                      <select
                        value={chargingState}
                        onChange={(e) => {
                          setChargingState(e.target.value as ChargingState);
                          setRunawayMode(false);
                        }}
                        disabled={runawayMode}
                        className="w-full bg-card border border-card-border rounded-lg p-2 text-xs font-semibold"
                      >
                        <option value="charging">Charging</option>
                        <option value="discharging">Discharging</option>
                        <option value="idle">Idle</option>
                      </select>
                    </div>

                    {/* Toggle Fast Charging */}
                    <div className="p-4 bg-muted-light rounded-xl flex items-center justify-between">
                      <div className="space-y-1">
                        <label className="text-xs text-muted uppercase font-bold tracking-wider block">Fast Charge</label>
                        <span className="text-2xs text-muted block">Boost current to 40A</span>
                      </div>
                      <input
                        type="checkbox"
                        checked={fastCharge}
                        onChange={(e) => setFastCharge(e.target.checked)}
                        disabled={chargingState !== "charging" || runawayMode}
                        className="h-4 w-4 text-primary focus:ring-primary border-card-border rounded"
                      />
                    </div>

                    {/* Toggle 80% Limit */}
                    <div className="p-4 bg-muted-light rounded-xl flex items-center justify-between">
                      <div className="space-y-1">
                        <label className="text-xs text-muted uppercase font-bold tracking-wider block">Cap at 80%</label>
                        <span className="text-2xs text-muted block">Preserve cycle lifespan</span>
                      </div>
                      <input
                        type="checkbox"
                        checked={chargeLimit80}
                        onChange={(e) => setChargeLimit80(e.target.checked)}
                        disabled={runawayMode}
                        className="h-4 w-4 text-primary focus:ring-primary border-card-border rounded"
                      />
                    </div>

                    {/* Trigger Runaway */}
                    <button
                      onClick={() => setRunawayMode(!runawayMode)}
                      className={`p-4 rounded-xl font-bold text-xs uppercase flex flex-col justify-center items-center gap-1 transition-all ${
                        runawayMode
                          ? "bg-danger text-white border border-danger shadow-md"
                          : "bg-muted-light hover:bg-card-border hover:text-danger text-foreground"
                      }`}
                    >
                      <span>{runawayMode ? "Stop Thermal Failure" : "Simulate Runaway"}</span>
                      <span className="text-2xs font-normal lowercase">{runawayMode ? "de-activate runaway" : "force thermal spike"}</span>
                    </button>

                  </div>
                </div>

                {/* SNN SPIKES TIMELINE MONITOR (OSCILLOSCOPE) */}
                <div className="bg-card border border-card-border rounded-2xl p-6 shadow-sm">
                  <div className="flex justify-between items-center mb-4">
                    <h3 className="text-base font-bold flex items-center gap-2">
                      <svg className="w-5 h-5 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                      </svg>
                      Delta-Modulation Neural Spike Monitor
                    </h3>
                    <span className="text-2xs text-muted bg-muted-light px-2.5 py-1 rounded-full uppercase tracking-wider font-semibold">
                      Spike Rate Dynamic
                    </span>
                  </div>

                  {/* Horizontal spike oscilloscope tracks */}
                  <div className="space-y-3 font-mono text-xs">
                    
                    {/* Voltage spikes row */}
                    <div className="bg-muted-light p-3 rounded-lg flex items-center justify-between">
                      <span className="w-24 font-bold text-muted uppercase text-2xs tracking-wider">Voltage (dV)</span>
                      <div className="flex gap-1.5 flex-1 justify-end ml-4 overflow-x-hidden">
                        {spikesHistory.slice(0, 15).map((s, idx) => (
                          <div
                            key={idx}
                            className={`h-5 w-5 rounded-full flex items-center justify-center font-bold text-2xs transition-all ${
                              s.voltage > 0
                                ? "bg-success text-white"
                                : s.voltage < 0
                                ? "bg-accent text-white"
                                : "bg-card/20 text-muted"
                            }`}
                          >
                            {s.voltage > 0 ? "+" : s.voltage < 0 ? "-" : ""}
                          </div>
                        ))}
                        {spikesHistory.length === 0 && <span className="text-muted-foreground text-2xs italic">Awaiting delta spikes...</span>}
                      </div>
                    </div>

                    {/* Current spikes row */}
                    <div className="bg-muted-light p-3 rounded-lg flex items-center justify-between">
                      <span className="w-24 font-bold text-muted uppercase text-2xs tracking-wider">Current (dI)</span>
                      <div className="flex gap-1.5 flex-1 justify-end ml-4 overflow-x-hidden">
                        {spikesHistory.slice(0, 15).map((s, idx) => (
                          <div
                            key={idx}
                            className={`h-5 w-5 rounded-full flex items-center justify-center font-bold text-2xs transition-all ${
                              s.current > 0
                                ? "bg-success text-white"
                                : s.current < 0
                                ? "bg-accent text-white"
                                : "bg-card/20 text-muted"
                            }`}
                          >
                            {s.current > 0 ? "+" : s.current < 0 ? "-" : ""}
                          </div>
                        ))}
                        {spikesHistory.length === 0 && <span className="text-muted-foreground text-2xs italic">Awaiting delta spikes...</span>}
                      </div>
                    </div>

                    {/* Temperature spikes row */}
                    <div className="bg-muted-light p-3 rounded-lg flex items-center justify-between">
                      <span className="w-24 font-bold text-muted uppercase text-2xs tracking-wider">Temp (dT)</span>
                      <div className="flex gap-1.5 flex-1 justify-end ml-4 overflow-x-hidden">
                        {spikesHistory.slice(0, 15).map((s, idx) => (
                          <div
                            key={idx}
                            className={`h-5 w-5 rounded-full flex items-center justify-center font-bold text-2xs transition-all ${
                              s.temperature > 0
                                ? "bg-danger text-white animate-bounce"
                                : s.temperature < 0
                                ? "bg-success text-white"
                                : "bg-card/20 text-muted"
                            }`}
                          >
                            {s.temperature > 0 ? "+" : s.temperature < 0 ? "-" : ""}
                          </div>
                        ))}
                        {spikesHistory.length === 0 && <span className="text-muted-foreground text-2xs italic">Awaiting delta spikes...</span>}
                      </div>
                    </div>

                  </div>
                </div>

              </div>
            )}

            {/* VIEW 2: PREDICTIVE ANALYTICS & DIGITAL TWIN */}
            {activeTab === "predictive" && (
              <div className="space-y-6">
                
                {/* Degradation Chart */}
                <div className="bg-card border border-card-border rounded-2xl p-6 shadow-sm">
                  <h3 className="text-base font-bold mb-4">SOH Capacity Degradation Curve</h3>
                  
                  {/* SVG Chart */}
                  <div className="w-full h-64 bg-muted-light rounded-xl p-4 flex items-center justify-center relative">
                    <svg className="w-full h-full" viewBox="0 0 500 200">
                      {/* Grid lines */}
                      <line x1="40" y1="10" x2="40" y2="170" stroke="var(--card-border)" strokeWidth="1" />
                      <line x1="40" y1="170" x2="480" y2="170" stroke="var(--card-border)" strokeWidth="1" />
                      <line x1="40" y1="90" x2="480" y2="90" stroke="var(--card-border)" strokeWidth="1" strokeDasharray="4" />
                      
                      {/* Labels */}
                      <text x="15" y="15" fill="var(--muted)" fontSize="9" fontFamily="monospace">100%</text>
                      <text x="15" y="90" fill="var(--muted)" fontSize="9" fontFamily="monospace">85%</text>
                      <text x="15" y="170" fill="var(--muted)" fontSize="9" fontFamily="monospace">70%</text>
                      <text x="40" y="185" fill="var(--muted)" fontSize="9" fontFamily="monospace">0 cycles</text>
                      <text x="260" y="185" fill="var(--muted)" fontSize="9" fontFamily="monospace">750 cycles</text>
                      <text x="440" y="185" fill="var(--muted)" fontSize="9" fontFamily="monospace">1500 cycles</text>

                      {/* Degradation Curve - Normal */}
                      <path
                        d="M 40 15 Q 260 90 480 150"
                        fill="none"
                        stroke="var(--primary)"
                        strokeWidth="3"
                        strokeLinecap="round"
                      />
                      
                      {/* Degradation Curve - High Current / Fast Charge */}
                      <path
                        d="M 40 15 Q 200 110 480 178"
                        fill="none"
                        stroke="var(--danger)"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeDasharray="4"
                      />

                      {/* Current Cycle Marker */}
                      {chargeCycles && (
                        <circle
                          cx={40 + (chargeCycles / 1500) * 440}
                          cy={15 + (100 - soh) * 4.5}
                          r="6"
                          fill="var(--accent)"
                        />
                      )}
                    </svg>
                    
                    <div className="absolute top-4 right-4 flex gap-4 text-2xs font-semibold">
                      <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-primary"></span> Normal degradation</span>
                      <span className="flex items-center gap-1.5"><span className="h-2 w-2 bg-danger rounded-full"></span> Fast charging accelerated</span>
                      <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 bg-accent rounded-full"></span> Current status</span>
                    </div>
                  </div>
                </div>

                {/* DIGITAL TWIN STATE COMPARATOR */}
                <div className="bg-card border border-card-border rounded-2xl p-6 shadow-sm">
                  <h3 className="text-base font-bold mb-4">Digital Twin Calibration State</h3>
                  
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    
                    {/* Physical Battery */}
                    <div className="bg-muted-light p-4 rounded-xl space-y-3">
                      <h4 className="text-xs font-bold uppercase text-primary tracking-wider">Physical Cell</h4>
                      <div className="space-y-1">
                        <span className="text-2xs text-muted block">Measured Temp</span>
                        <span className="text-lg font-bold">{temperature}°C</span>
                      </div>
                      <div className="space-y-1">
                        <span className="text-2xs text-muted block">Measured Voltage</span>
                        <span className="text-lg font-bold">{voltage}V</span>
                      </div>
                    </div>

                    {/* Digital Twin */}
                    <div className="bg-muted-light p-4 rounded-xl space-y-3">
                      <h4 className="text-xs font-bold uppercase text-accent tracking-wider">Twin (Ideal Model)</h4>
                      <div className="space-y-1">
                        <span className="text-2xs text-muted block">Model Temp</span>
                        <span className="text-lg font-bold">{twinTemp.toFixed(2)}°C</span>
                      </div>
                      <div className="space-y-1">
                        <span className="text-2xs text-muted block">Model Voltage</span>
                        <span className="text-lg font-bold">{twinVoltage.toFixed(3)}V</span>
                      </div>
                    </div>

                    {/* Drift Discrepancy */}
                    <div className="bg-muted-light p-4 rounded-xl space-y-3">
                      <h4 className="text-xs font-bold uppercase text-muted tracking-wider">Model Drift Delta</h4>
                      <div className="space-y-1">
                        <span className="text-2xs text-muted block">Thermal Delta</span>
                        <span className={`text-lg font-bold ${Math.abs(temperature - twinTemp) > 2.0 ? 'text-danger' : 'text-success'}`}>
                          {Math.abs(temperature - twinTemp).toFixed(2)}°C
                        </span>
                      </div>
                      <div className="space-y-1">
                        <span className="text-2xs text-muted block">Voltage Delta</span>
                        <span className="text-lg font-bold text-success">
                          {Math.abs(voltage - twinVoltage).toFixed(3)}V
                        </span>
                      </div>
                    </div>

                  </div>
                </div>

              </div>
            )}

            {/* VIEW 3: SMART RECOMMENDATIONS & AI EXPLORER */}
            {activeTab === "recommendations" && (
              <div className="space-y-6">
                
                {/* AI PRESERVATION TIPS */}
                <div className="bg-card border border-card-border rounded-2xl p-6 shadow-sm space-y-4">
                  <h3 className="text-base font-bold">Recommended preservation strategies</h3>
                  
                  <div className="space-y-3">
                    
                    {temperature > 35.0 && (
                      <div className="flex gap-3 bg-danger/10 text-danger border border-danger/20 p-4 rounded-xl text-xs">
                        <svg className="w-5 h-5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                        </svg>
                        <div>
                          <strong className="block font-semibold mb-1">Cooling phase recommended</strong>
                          Cell temperature is elevated ({temperature}°C). Restrict fast charging current to prevent electrolyte breakdown.
                        </div>
                      </div>
                    )}

                    <div className="flex gap-3 bg-muted-light p-4 rounded-xl text-xs">
                      <svg className="w-5 h-5 text-primary flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      <div>
                        <strong className="block font-semibold mb-1">Charge Limiting (80% SOC cap)</strong>
                        Enabling the 80% charge limit is projected to extend the Remaining Useful Life from **{rul}** to **{rul + 450} cycles**, slowing active cathode erosion.
                      </div>
                    </div>

                    <div className="flex gap-3 bg-muted-light p-4 rounded-xl text-xs">
                      <svg className="w-5 h-5 text-primary flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      <div>
                        <strong className="block font-semibold mb-1">Constant-Voltage absorption phase optimize</strong>
                        High-current charging was sustained for {chargeCycles > 200 ? "42" : "28"} cycles. Transitioning into CV (constant-voltage) mode earlier is recommended to reduce grid lattice stresses.
                      </div>
                    </div>

                  </div>
                </div>

                {/* AI EXPLORER QA PORTAL */}
                <div className="bg-card border border-card-border rounded-2xl p-6 shadow-sm">
                  <h3 className="text-base font-bold mb-4 flex items-center gap-2">
                    <svg className="w-5 h-5 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    AI Explorer: Neuromorphic Physics Portal
                  </h3>

                  <div className="space-y-3">
                    {qaData.map((qa, index) => (
                      <div key={index} className="border border-card-border rounded-xl overflow-hidden bg-muted-light">
                        <button
                          onClick={() => setSelectedQA(selectedQA === index ? null : index)}
                          className="w-full flex justify-between items-center p-4 text-left font-semibold text-xs transition-all hover:bg-card-border/50"
                        >
                          <span>{qa.q}</span>
                          <svg
                            className={`w-4 h-4 text-muted transition-transform duration-300 ${selectedQA === index ? 'rotate-180' : ''}`}
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                          >
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                          </svg>
                        </button>
                        
                        {selectedQA === index && (
                          <div className="p-4 bg-card border-t border-card-border text-xs leading-relaxed text-muted-foreground transition-all">
                            {qa.a}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

              </div>
            )}

          </div>

          {/* COLUMN 3: SNN MONITORING & LOG PANEL */}
          <div className="space-y-6">
            
            {/* SNN NEURON INTEGRATION STATUS */}
            <div className="bg-card border border-card-border rounded-2xl p-6 shadow-sm space-y-4">
              <h3 className="text-base font-bold flex items-center gap-2">
                <svg className="w-5 h-5 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                LIF Neuron State Monitor
              </h3>

              <div className="space-y-4 text-xs">
                
                {/* Membrane potential meter bar */}
                <div className="space-y-2">
                  <div className="flex justify-between font-mono">
                    <span className="text-muted">Membrane Potential (V_m):</span>
                    <span className="font-bold">{membranePotential} / {vThreshold} V</span>
                  </div>
                  <div className="w-full bg-muted-light h-3 rounded-full overflow-hidden relative">
                    <div
                      className={`h-full transition-all duration-300 ${
                        membranePotential > 0.7 ? "bg-danger" : membranePotential > 0.4 ? "bg-accent" : "bg-primary"
                      }`}
                      style={{ width: `${Math.min(100, (membranePotential / vThreshold) * 100)}%` }}
                    ></div>
                    {/* Threshold line indicator */}
                    <div className="absolute right-0 top-0 bottom-0 w-0.5 bg-danger/50" style={{ left: "100%" }}></div>
                  </div>
                </div>

                {/* Weights info config table */}
                <div className="bg-muted-light rounded-xl p-3 space-y-1 font-mono text-2xs text-muted-foreground">
                  <div className="flex justify-between">
                    <span>Rest Potential:</span>
                    <span>{vRest}V</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Firing Threshold:</span>
                    <span>{vThreshold}V</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Temp Spike Weight (w_T):</span>
                    <span>+0.55</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Current Spike Weight (w_I):</span>
                    <span>+0.25</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Leak Constant (tau):</span>
                    <span>4.0 steps</span>
                  </div>
                </div>

              </div>
            </div>

            {/* LIVE SYSTEM ALERTS & EVENT FEED LOG */}
            <div className="bg-card border border-card-border rounded-2xl p-6 shadow-sm space-y-4">
              <h3 className="text-base font-bold">SNN Alert & Event Feed</h3>
              
              <div className="space-y-3 max-h-80 overflow-y-auto pr-1">
                {alerts.map((alert) => (
                  <div
                    key={alert.id}
                    className={`p-3 rounded-xl border text-2xs space-y-1.5 transition-all duration-300 ${
                      alert.type === "danger"
                        ? "bg-danger/10 border-danger/20 text-danger"
                        : alert.type === "warning"
                        ? "bg-accent/10 border-accent/20 text-accent"
                        : "bg-muted-light border-card-border text-muted-foreground"
                    }`}
                  >
                    <div className="flex justify-between items-center font-bold">
                      <span className="uppercase tracking-wider">
                        {alert.type === "danger" ? "Critical Alert" : alert.type === "warning" ? "Warning" : "Log Event"}
                      </span>
                      <span>{mounted ? alert.timestamp : ""}</span>
                    </div>
                    <p className="leading-normal">{alert.message}</p>
                  </div>
                ))}
              </div>
            </div>

          </div>

        </div>

      </main>

    </div>
  );
}
