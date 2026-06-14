"use client";

import React, { useState, useEffect, useRef } from "react";

type Tab = "realtime" | "predictive" | "recommendations";
type ChargingState = "charging" | "discharging" | "idle";

interface SpikeEvent {
  time: string;
  voltage: number;
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
  const [view, setView] = useState<"landing" | "dashboard">("landing");

  const [animatedSoc, setAnimatedSoc] = useState(0);
  const [animatedTemp, setAnimatedTemp] = useState(0);
  const [animatedVolt, setAnimatedVolt] = useState(0);
  const [animatedCurr, setAnimatedCurr] = useState(0);
  const [animatedSoh, setAnimatedSoh] = useState(0);
  const [animatedRul, setAnimatedRul] = useState(0);
  const [animatedLif, setAnimatedLif] = useState(0);
  const [hasAnimatedCounters, setHasAnimatedCounters] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (view === "landing") {
      setHasAnimatedCounters(false);
    }
  }, [view]);

  useEffect(() => {
    if (activeTab !== "realtime") {
      setHasAnimatedCounters(false);
    }
  }, [activeTab]);

  const [chargingState, setChargingState] = useState<ChargingState>("charging");
  const [fastCharge, setFastCharge] = useState(false);
  const [chargeLimit80, setChargeLimit80] = useState(false);
  const [runawayMode, setRunawayMode] = useState(false);

  const [soc, setSoc] = useState(55.0);
  const [temperature, setTemperature] = useState(26.2);
  const [voltage, setVoltage] = useState(3.82);
  const [current, setCurrent] = useState(25.0);
  const [chargeCycles, setChargeCycles] = useState(180);
  const [soh, setSoh] = useState(99.15);
  const [rul, setRul] = useState(1320);

  const [twinTemp, setTwinTemp] = useState(25.4);
  const [twinVoltage, setTwinVoltage] = useState(3.85);

  const [membranePotential, setMembranePotential] = useState(0.0);
  const [vThreshold] = useState(1.0);
  const [vRest] = useState(0.0);
  const [tau] = useState(4.0);

  const refVoltage = useRef(3.82);
  const refCurrent = useRef(25.0);
  const refTemperature = useRef(26.2);
  const refCycles = useRef(180);

  const [spikesHistory, setSpikesHistory] = useState<SpikeEvent[]>([]);
  const [alerts, setAlerts] = useState<AlertLog[]>([
    {
      id: "init",
      timestamp: new Date().toLocaleTimeString(),
      type: "info",
      message: "NeuroCharge SNN engine initialized. Reference baselines calibrated.",
    },
  ]);

  const [selectedQA, setSelectedQA] = useState<number | null>(null);
  const [connectToAPI, setConnectToAPI] = useState(false);
  const [apiToken, setApiToken] = useState<string | null>(null);
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [serverLatency, setServerLatency] = useState<number | null>(null);
  const [networkLatency, setNetworkLatency] = useState<number | null>(null);
  const [connectionError, setConnectionError] = useState(false);
  const [backendRecommendations, setBackendRecommendations] = useState<string[]>([]);
  const [backendWarnings, setBackendWarnings] = useState<string[]>([]);
  const [projectedDecayCurve, setProjectedDecayCurve] = useState<{ cycles: number; projected_soh: number }[]>([]);

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
      const formData = new URLSearchParams();
      formData.append("username", "admin@neurocharge.com");
      formData.append("password", "adminpassword123");
      try {
        const response = await fetch("http://127.0.0.1:8000/api/v1/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: formData,
        });
        if (!response.ok) throw new Error("Authentication failed");
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

  useEffect(() => {
    const interval = setInterval(async () => {
      let nextState = chargingState;
      let nextCurrent = current;
      let nextSoc = soc;
      let nextTemp = temperature;
      let nextCycles = chargeCycles;

      if (runawayMode) {
        nextState = "charging";
        nextCurrent = 48.5 + Math.random();
      } else if (chargingState === "charging") {
        nextCurrent = fastCharge ? 40.0 : 20.0;
        nextCurrent += (Math.random() - 0.5) * 0.8;
      } else if (chargingState === "discharging") {
        nextCurrent = -15.0 - Math.random() * 5;
      } else {
        nextCurrent = 0.0;
      }

      if (nextState === "charging") {
        nextSoc += ((nextCurrent * 1.5) / 3600.0 / 100.0) * 100.0;
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
        nextSoc += ((nextCurrent * 1.5) / 3600.0 / 100.0) * 100.0;
        if (nextSoc <= 5.0) {
          nextSoc = 5.0;
          setChargingState("idle");
          addAlert("warning", "Battery low: discharging terminated.");
        }
      }

      const socRatio = nextSoc / 100.0;
      const ocv = 3.2 + 0.8 * socRatio - 0.04 * Math.exp(-15 * socRatio);
      let nextVoltage = Math.max(2.8, Math.min(4.25, ocv + nextCurrent * 0.012));

      const ambientTemp = 24.5;
      const heatGen = nextCurrent ** 2 * 0.012;
      const heatLoss = 0.35 * (nextTemp - ambientTemp);
      let dT = ((heatGen - heatLoss) / 780.0) * 1.5;
      if (runawayMode) {
        const m = nextTemp > 35.0 ? (nextTemp - 30.0) * 0.25 : 0.6;
        dT += m * 3.5;
      }
      nextTemp += dT;

      if ((Math.abs(nextCurrent) * 1.5) / 3600.0 > 0.005 && Math.random() < 0.05) nextCycles += 1;

      setSoc(Number(nextSoc.toFixed(2)));
      setVoltage(Number(nextVoltage.toFixed(3)));
      setCurrent(Number(nextCurrent.toFixed(2)));
      setTemperature(Number(nextTemp.toFixed(2)));
      setChargeCycles(nextCycles);
      setTwinTemp(ambientTemp + ((heatGen - 0.35 * (twinTemp - ambientTemp)) / 780.0) * 1.5);
      setTwinVoltage(ocv + nextCurrent * 0.008);

      const cycleStress = nextCycles * 0.0045;
      const tempStress = nextTemp > 38.0 ? (nextTemp - 35) * 0.08 : 0.0;
      setSoh(Number(Math.max(70.0, 100.0 - cycleStress - tempStress).toFixed(3)));
      setRul(Math.max(0, Math.round(1500 - nextCycles - tempStress * 250)));

      if (connectToAPI && apiToken) {
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
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiToken}` },
            body: JSON.stringify(payload),
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
          setServerLatency(resData.processing_latency_ms);
          setNetworkLatency(Date.now() - postStart);
          const { voltage: sV, current: sI, temperature: sT, charge_cycles: sC } = resData.spikes;
          if (sV !== 0 || sI !== 0 || sT !== 0 || sC !== 0)
            setSpikesHistory(prev => [{ time: new Date().toLocaleTimeString(), voltage: sV, current: sI, temperature: sT, chargeCycles: sC }, ...prev.slice(0, 19)]);
          if (resData.thermal_anomaly_detected)
            addAlert("danger", "CRITICAL ALERT (API): SNN Anomaly Detected! Rapid cell temperature elevation. Battery shutoff recommended.");

          const statusRes = await fetch("http://127.0.0.1:8000/api/v1/battery/BAT-NEURO-901/status", { headers: { Authorization: `Bearer ${apiToken}` } });
          if (statusRes.ok) setMembranePotential((await statusRes.json()).membrane_potential);

          const healthRes = await fetch("http://127.0.0.1:8000/api/v1/battery/BAT-NEURO-901/health", { headers: { Authorization: `Bearer ${apiToken}` } });
          if (healthRes.ok) setSoh((await healthRes.json()).state_of_health);

          const predRes = await fetch("http://127.0.0.1:8000/api/v1/battery/BAT-NEURO-901/predictions", { headers: { Authorization: `Bearer ${apiToken}` } });
          if (predRes.ok) {
            const d = await predRes.json();
            setRul(d.predicted_rul);
            setProjectedDecayCurve(d.projected_decay_curve);
          }

          const recRes = await fetch("http://127.0.0.1:8000/api/v1/battery/BAT-NEURO-901/recommendations", { headers: { Authorization: `Bearer ${apiToken}` } });
          if (recRes.ok) {
            const d = await recRes.json();
            setBackendRecommendations(d.recommendations);
            setBackendWarnings(d.warnings);
          }
        } catch (err) {
          console.error(err);
          setConnectToAPI(false);
          addAlert("warning", "Connection lost. API server was shut down.");
        }
      } else {
        let sV = 0, sI = 0, sT = 0, sC = 0;
        const diffV = nextVoltage - refVoltage.current;
        if (diffV >= 0.05) {
          sV = 1;
          refVoltage.current = nextVoltage;
        } else if (diffV <= -0.05) {
          sV = -1;
          refVoltage.current = nextVoltage;
        }
        const diffI = nextCurrent - refCurrent.current;
        if (diffI >= 0.8) {
          sI = 1;
          refCurrent.current = nextCurrent;
        } else if (diffI <= -0.8) {
          sI = -1;
          refCurrent.current = nextCurrent;
        }
        const diffT = nextTemp - refTemperature.current;
        if (diffT >= 0.2) {
          sT = 1;
          refTemperature.current = nextTemp;
        } else if (diffT <= -0.2) {
          sT = -1;
          refTemperature.current = nextTemp;
        }
        if (nextCycles - refCycles.current >= 1) {
          sC = 1;
          refCycles.current = nextCycles;
        }
        if (sV !== 0 || sI !== 0 || sT !== 0 || sC !== 0)
          setSpikesHistory(prev => [{ time: new Date().toLocaleTimeString(), voltage: sV, current: sI, temperature: sT, chargeCycles: sC }, ...prev.slice(0, 19)]);

        let v_m = membranePotential - (membranePotential - vRest) / tau;
        v_m += 0.55 * (sT > 0 ? 1.0 : 0.0) + 0.25 * (sI > 0 ? 1.0 : 0.0);
        if (nextTemp > 45.0) v_m += 0.4;
        if (nextTemp > 55.0) v_m = vThreshold + 0.1;
        if (v_m >= vThreshold) {
          v_m = vRest;
          addAlert("danger", "CRITICAL ALERT (Local): SNN Anomaly Detected! Rapid cell temperature elevation. Battery shutoff recommended.");
        }
        setMembranePotential(Number(v_m.toFixed(3)));
      }
    }, 1500);
    return () => clearInterval(interval);
  }, [soc, temperature, voltage, current, chargeCycles, membranePotential, chargingState, fastCharge, chargeLimit80, runawayMode, twinTemp, twinVoltage, connectToAPI, apiToken]);

  useEffect(() => {
    if (view !== "dashboard") {
      setHasAnimatedCounters(false);
      return;
    }
    if (activeTab !== "realtime" || hasAnimatedCounters) return;

    const startTime = performance.now();
    const duration = 1200;
    let frameId: number;

    const animate = (currentTime: number) => {
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const ease = 1 - Math.pow(1 - progress, 3);

      setAnimatedSoc(soc * ease);
      setAnimatedTemp(temperature * ease);
      setAnimatedVolt(voltage * ease);
      setAnimatedCurr(current * ease);
      setAnimatedSoh(soh * ease);
      setAnimatedRul(rul * ease);
      setAnimatedLif(membranePotential * ease);

      if (progress < 1) {
        frameId = requestAnimationFrame(animate);
      } else {
        setHasAnimatedCounters(true);
      }
    };

    frameId = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frameId);
  }, [view, activeTab, hasAnimatedCounters]);

  const getBackendDecayPath = () => {
    if (!projectedDecayCurve?.length) return "";
    return projectedDecayCurve.map((pt, i) => `${i === 0 ? "M" : "L"} ${40 + (pt.cycles / 1500) * 440} ${15 + (100 - pt.projected_soh) * 4.5}`).join(" ");
  };

  const addAlert = (type: "warning" | "danger" | "info", message: string) =>
    setAlerts(prev => [{ id: Math.random().toString(), timestamp: new Date().toLocaleTimeString(), type, message }, ...prev.slice(0, 14)]);

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
      a: "Delta-modulation converts continuous signals into discrete events (spikes). When a continuous parameter changes from its last reference level by more than a pre-defined threshold, it generates an UP (+1) or DOWN (-1) event and updates its reference. This mimics biological sensory receptors, minimizing data processing overhead and lowering latency to <5ms.",
    },
    {
      q: "How does the Leaky Integrate-and-Fire (LIF) model detect anomalies?",
      a: "The LIF model simulates the membrane potential of a biological neuron. It continuously integrates incoming event spikes while slowly leaking potential over time. If a flurry of warning spikes arrives within a short window, the potential accumulates and crosses a threshold, instantly firing an anomaly trigger.",
    },
    {
      q: "Why does fast charging accelerate battery degradation?",
      a: "Fast charging pushes higher currents into the cell, generating substantial Joule heating proportional to Current squared. High temperatures accelerate lithium plating, SEI layer growth, and mechanical cell cracking. Limiting fast charging extends cell cycle life considerably.",
    },
  ];

  if (view === "landing") {
    return (
      <div className="flex flex-col min-h-screen bg-brand-bg text-brand-dark">
        <header className="sticky top-0 z-50 w-full border-b border-brand-accent bg-brand-bg/90 backdrop-blur-md px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3 cursor-pointer" onClick={() => setView("landing")}>
            <div className="h-8 w-8 rounded-full bg-brand-primary flex items-center justify-center text-white font-bold text-sm tracking-wider shadow">
              NC
            </div>
            <div>
              <h1 className="font-bold text-lg leading-tight tracking-tight text-brand-dark">NeuroCharge</h1>
              <span className="text-xs text-brand-muted font-medium uppercase tracking-widest block">SNN Platform</span>
            </div>
          </div>
          <button
            onClick={() => setView("dashboard")}
            className="px-5 py-2.5 border border-brand-primary text-brand-primary hover:bg-brand-accent/20 text-xs font-semibold rounded-xl transition-all flex items-center gap-2 cursor-pointer"
          >
            Enter Dashboard
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </header>

        <main className="flex-1 flex flex-col items-center justify-center max-w-5xl mx-auto px-6 py-16 text-center space-y-8">
          <div className="animate-fade-up delay-100 start-hidden">
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-brand-accent/30 text-brand-primary border border-brand-accent">
              <span className="h-1.5 w-1.5 rounded-full bg-brand-primary animate-pulse" />
              Neuromorphic EV Intelligence
            </span>
          </div>

          <h2 className="text-4xl md:text-6xl font-black tracking-tight leading-none text-brand-dark max-w-3xl animate-fade-up delay-200 start-hidden">
            Neuromorphic Battery Intelligence
          </h2>

          <p className="text-sm md:text-base text-brand-muted max-w-2xl leading-relaxed animate-fade-up delay-300 start-hidden">
            A brain-inspired EV battery management platform that continuously learns charging behavior, predicts capacity degradation, and instantly detects thermal runaway anomalies using stateful Spiking Neural Networks.
          </p>

          <div className="animate-fade-up delay-300 start-hidden flex flex-col sm:flex-row gap-4 justify-center items-center pt-4">
            <button
              onClick={() => setView("dashboard")}
              className="px-6 py-3.5 bg-brand-primary text-white hover:bg-brand-muted text-sm font-semibold rounded-xl transition-all shadow-md flex items-center gap-2 cursor-pointer"
            >
              Enter Real-Time Dashboard
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 5l7 7-7 7" />
              </svg>
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 w-full pt-16 animate-fade-up delay-400 start-hidden">
            <div className="bg-white border border-brand-primary/20 p-6 rounded-2xl text-left hover:-translate-y-[2px] hover:shadow-lg transition-all duration-300 space-y-4">
              <div className="h-10 w-10 bg-brand-accent/30 text-brand-primary rounded-xl flex items-center justify-center">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                </svg>
              </div>
              <h3 className="font-bold text-base text-brand-dark">Spiking Neural Network Engine</h3>
              <p className="text-xs text-brand-muted leading-relaxed">
                Simulates biological neural dynamics using a stateful Leaky Integrate-and-Fire (LIF) model to track complex temporal characteristics of battery chemistry.
              </p>
            </div>

            <div className="bg-white border border-brand-primary/20 p-6 rounded-2xl text-left hover:-translate-y-[2px] hover:shadow-lg transition-all duration-300 space-y-4">
              <div className="h-10 w-10 bg-red-50 text-danger rounded-xl flex items-center justify-center">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
              </div>
              <h3 className="font-bold text-base text-brand-dark">Thermal Anomaly Engine</h3>
              <p className="text-xs text-brand-muted leading-relaxed">
                Applies optimized delta-modulation event encoding to continuous telemetry, checking for safety anomalies in under 1 second to prevent critical runaway risk.
              </p>
            </div>

            <div className="bg-white border border-brand-primary/20 p-6 rounded-2xl text-left hover:-translate-y-[2px] hover:shadow-lg transition-all duration-300 space-y-4">
              <div className="h-10 w-10 bg-brand-accent/30 text-brand-primary rounded-xl flex items-center justify-center">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <h3 className="font-bold text-base text-brand-dark">Adaptive Health Projections</h3>
              <p className="text-xs text-brand-muted leading-relaxed">
                Runs background LSTM predictive intelligence to estimate capacity retention, State of Health (SOH), and Remaining Useful Life (RUL).
              </p>
            </div>
          </div>
        </main>

        <footer className="w-full border-t border-brand-accent py-6 text-center text-xs text-brand-muted font-medium uppercase tracking-widest">
          &copy; {new Date().getFullYear()} NeuroCharge. All rights reserved.
        </footer>
      </div>
    );
  }

  return (
    <div className="flex flex-1 min-h-screen bg-brand-bg text-brand-dark">
      <aside className="w-64 border-r border-brand-accent bg-white p-6 flex-col justify-between hidden md:flex shadow-sm">
        <div>
          <div onClick={() => setView("landing")} className="flex items-center gap-3 mb-8 cursor-pointer hover:opacity-80 transition-all">
            <div className="h-8 w-8 rounded-full bg-brand-primary flex items-center justify-center text-white font-bold text-sm tracking-wider">NC</div>
            <div>
              <h1 className="font-bold text-lg leading-tight tracking-tight text-brand-dark">NeuroCharge</h1>
              <span className="text-xs text-brand-muted font-medium uppercase tracking-widest">SNN Platform</span>
            </div>
          </div>

          <nav className="space-y-1">
            {[
              {
                key: "realtime",
                label: "Live Monitor",
                icon: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />,
              },
              {
                key: "predictive",
                label: "Predictive Twin",
                icon: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />,
              },
              {
                key: "recommendations",
                label: "AI Preservation",
                icon: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />,
              },
            ].map(({ key, label, icon }) => (
              <button
                key={key}
                onClick={() => setActiveTab(key as Tab)}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm transition-all ${
                  activeTab === key
                    ? "bg-brand-accent/30 text-brand-primary font-semibold"
                    : "text-brand-muted hover:bg-brand-accent/20 hover:text-brand-dark"
                }`}
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">{icon}</svg>
                {label}
              </button>
            ))}
          </nav>

          <div className="mt-8 pt-6 border-t border-brand-accent space-y-3">
            <span className="text-xs font-bold uppercase tracking-widest text-brand-muted block">Database Integration</span>
            <div className="flex items-center justify-between bg-brand-accent/20 p-3.5 rounded-xl">
              <div className="space-y-0.5">
                <span className="text-xs font-semibold text-brand-dark block">Live API link</span>
                <span className="text-xs text-brand-muted block">Persist records to SQL</span>
              </div>
              <input
                type="checkbox"
                checked={connectToAPI}
                disabled={isAuthenticating}
                onChange={(e) => setConnectToAPI(e.target.checked)}
                className="h-4 w-4 accent-brand-primary border-brand-accent rounded"
              />
            </div>
            {isAuthenticating && <span className="text-xs text-brand-muted block animate-pulse font-semibold">Authenticating admin session...</span>}
            {connectionError && <span className="text-xs text-danger block font-semibold">Connection failed: API down?</span>}
          </div>
        </div>

        <div className="bg-brand-accent/20 rounded-xl p-4 text-xs space-y-3">
          <div className="flex justify-between items-center">
            <span className="text-brand-muted">Link Connection:</span>
            <span className={`font-semibold flex items-center gap-1 ${connectToAPI ? "text-success" : "text-brand-muted"}`}>
              <span className={`h-1.5 w-1.5 rounded-full bg-current ${connectToAPI ? "animate-pulse" : ""}`} />
              {connectToAPI ? "API Streaming" : "Local Sim"}
            </span>
          </div>
          {connectToAPI && (
            <>
              <div className="flex justify-between font-mono">
                <span className="text-brand-muted">API Latency:</span>
                <span className="text-brand-dark">{serverLatency !== null ? `${serverLatency.toFixed(2)}ms` : "checking..."}</span>
              </div>
              <div className="flex justify-between font-mono">
                <span className="text-brand-muted">Roundtrip Lag:</span>
                <span className="text-brand-dark">{networkLatency !== null ? `${networkLatency}ms` : "checking..."}</span>
              </div>
            </>
          )}
          <div className="flex justify-between items-center">
            <span className="text-brand-muted">SNN Model:</span>
            <span className="font-semibold text-brand-primary">LIF-Thermal v1</span>
          </div>
        </div>
      </aside>

      <main className="flex-1 flex flex-col p-4 md:p-8 space-y-6 overflow-y-auto">
        <header className="flex justify-between items-center border-b border-brand-accent pb-4">
          <div>
            <h2 className="text-2xl font-bold tracking-tight text-brand-dark">EV Battery Intelligence</h2>
            <p className="text-sm text-brand-muted">
              Real-time neuromorphic analytics for LFP Battery Pack{" "}
              <code className="bg-brand-accent/30 px-1.5 py-0.5 rounded text-brand-primary font-mono text-xs">BAT-NEURO-901</code>
            </p>
          </div>
          <div className="flex items-center gap-3">
            {runawayMode && (
              <span className="bg-danger text-white px-3 py-1 rounded-full text-xs font-semibold uppercase animate-pulse">
                Runaway Active
              </span>
            )}
            <button
              onClick={handleReset}
              className="px-4 py-2 border border-brand-primary text-brand-primary hover:bg-brand-accent/20 rounded-lg transition-all text-xs font-semibold"
            >
              Reset Simulation
            </button>
          </div>
        </header>

        <div className="flex md:hidden border border-brand-accent rounded-lg bg-white overflow-hidden">
          {(["realtime", "predictive", "recommendations"] as Tab[]).map((t, i) => (
            <button
              key={t}
              onClick={() => setActiveTab(t)}
              className={`flex-1 py-3 text-xs font-semibold transition-all ${activeTab === t ? "bg-brand-primary text-white" : "text-brand-muted"}`}
            >
              {["Live Monitor", "Predictive Twin", "AI Preservation"][i]}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            {activeTab === "realtime" && (
              <div className="space-y-6">
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                  <div className="metric-card bg-white border border-brand-primary/20 rounded-2xl p-5 hover:-translate-y-[2px] hover:shadow-lg transition-all duration-200 shadow-sm animate-card-entry delay-stagger-0">
                    <span className="text-xs text-brand-muted font-bold uppercase tracking-wider block mb-1">State of Charge</span>
                    <div className="flex items-baseline gap-1 mt-2">
                      <span className="text-3xl font-extrabold tracking-tight text-brand-dark">
                        {hasAnimatedCounters ? `${soc}%` : `${animatedSoc.toFixed(2)}%`}
                      </span>
                    </div>
                    <div className="w-full bg-brand-accent/50 h-1.5 rounded-full mt-4 overflow-hidden">
                      <div
                        className={`bg-brand-primary h-full ${hasAnimatedCounters ? "transition-all duration-500" : ""}`}
                        style={{ width: `${hasAnimatedCounters ? soc : animatedSoc}%` }}
                      />
                    </div>
                  </div>

                  <div className={`metric-card bg-white border rounded-2xl p-5 hover:-translate-y-[2px] hover:shadow-lg transition-all duration-200 shadow-sm animate-card-entry delay-stagger-1 ${temperature > 40 ? "border-danger" : "border-brand-primary/20"}`}>
                    <span className="text-xs text-brand-muted font-bold uppercase tracking-wider block mb-1">Cell Temp</span>
                    <div className="flex items-baseline gap-1 mt-2">
                      <span className={`text-3xl font-extrabold tracking-tight ${temperature > 40 ? "text-danger" : "text-brand-dark"}`}>
                        {hasAnimatedCounters ? `${temperature}°C` : `${animatedTemp.toFixed(2)}°C`}
                      </span>
                    </div>
                    <span className="text-xs text-brand-muted mt-2 block">
                      {runawayMode ? "Critical Rising" : temperature > 32 ? "Warning Threshold" : "Thermal Stable"}
                    </span>
                  </div>

                  <div className="metric-card bg-white border border-brand-primary/20 rounded-2xl p-5 hover:-translate-y-[2px] hover:shadow-lg transition-all duration-200 shadow-sm animate-card-entry delay-stagger-2">
                    <span className="text-xs text-brand-muted font-bold uppercase tracking-wider block mb-1">Terminal Voltage</span>
                    <div className="flex items-baseline gap-1 mt-2">
                      <span className="text-3xl font-extrabold tracking-tight text-brand-dark">
                        {hasAnimatedCounters ? `${voltage}V` : `${animatedVolt.toFixed(3)}V`}
                      </span>
                    </div>
                    <span className="text-xs text-brand-muted mt-2 block">Cell limit: 4.2V</span>
                  </div>

                  <div className="metric-card bg-white border border-brand-primary/20 rounded-2xl p-5 hover:-translate-y-[2px] hover:shadow-lg transition-all duration-200 shadow-sm animate-card-entry delay-stagger-3">
                    <span className="text-xs text-brand-muted font-bold uppercase tracking-wider block mb-1">Current Draw</span>
                    <div className="flex items-baseline gap-1 mt-2">
                      <span className={`text-3xl font-extrabold tracking-tight ${current > 0 ? "text-success" : current < 0 ? "text-brand-muted" : "text-brand-dark"}`}>
                        {hasAnimatedCounters ? (current > 0 ? `+${current}` : current) : (animatedCurr > 0 ? `+${animatedCurr.toFixed(2)}` : animatedCurr.toFixed(2))}A
                      </span>
                    </div>
                    <span className="text-xs text-brand-muted mt-2 block">
                      {current > 0 ? "Fast Charging" : current < 0 ? "Discharging Load" : "Idle Static"}
                    </span>
                  </div>

                  <div className="metric-card bg-white border border-brand-primary/20 rounded-2xl p-5 hover:-translate-y-[2px] hover:shadow-lg transition-all duration-200 shadow-sm animate-card-entry delay-stagger-4">
                    <span className="text-xs text-brand-muted font-bold uppercase tracking-wider block mb-1">Predicted SOH</span>
                    <div className="flex items-baseline gap-1 mt-2">
                      <span className="text-3xl font-extrabold tracking-tight text-brand-dark">
                        {hasAnimatedCounters ? `${soh}%` : `${animatedSoh.toFixed(3)}%`}
                      </span>
                    </div>
                    <span className="text-xs text-brand-muted mt-2 block">Capacity retention</span>
                  </div>

                  <div className="metric-card bg-white border border-brand-primary/20 rounded-2xl p-5 hover:-translate-y-[2px] hover:shadow-lg transition-all duration-200 shadow-sm animate-card-entry delay-stagger-5">
                    <span className="text-xs text-brand-muted font-bold uppercase tracking-wider block mb-1">RUL Projection</span>
                    <div className="flex items-baseline gap-1 mt-2">
                      <span className="text-3xl font-extrabold tracking-tight text-brand-dark">
                        {hasAnimatedCounters ? `${rul} cycles` : `${Math.round(animatedRul)} cycles`}
                      </span>
                    </div>
                    <span className="text-xs text-brand-muted mt-2 block">Cycle life remaining</span>
                  </div>
                </div>

                <div className="bg-white border border-brand-primary/20 rounded-2xl p-6 shadow-sm">
                  <h3 className="text-base font-bold mb-4 flex items-center gap-2 text-brand-dark">
                    <svg className="w-5 h-5 text-brand-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                    Cell Simulation Control Center
                  </h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
                    <div className="p-4 bg-brand-accent/20 rounded-xl space-y-2 hover:-translate-y-[2px] hover:shadow-lg transition-all duration-200">
                      <label className="text-xs text-brand-muted uppercase font-bold tracking-wider">Charging State</label>
                      <select
                        value={chargingState}
                        onChange={(e) => { setChargingState(e.target.value as ChargingState); setRunawayMode(false); }}
                        disabled={runawayMode}
                        className="w-full bg-white border border-brand-accent rounded-lg p-2 text-xs font-semibold text-brand-dark focus:outline-none focus:ring-1 focus:ring-brand-primary"
                      >
                        <option value="charging">Charging</option>
                        <option value="discharging">Discharging</option>
                        <option value="idle">Idle</option>
                      </select>
                    </div>

                    <div className="p-4 bg-brand-accent/20 rounded-xl flex items-center justify-between hover:-translate-y-[2px] hover:shadow-lg transition-all duration-200">
                      <div className="space-y-1">
                        <label className="text-xs text-brand-muted uppercase font-bold tracking-wider block">Fast Charge</label>
                        <span className="text-xs text-brand-muted block">Boost current to 40A</span>
                      </div>
                      <input
                        type="checkbox"
                        checked={fastCharge}
                        onChange={(e) => setFastCharge(e.target.checked)}
                        disabled={chargingState !== "charging" || runawayMode}
                        className="h-4 w-4 accent-brand-primary rounded"
                      />
                    </div>

                    <div className="p-4 bg-brand-accent/20 rounded-xl flex items-center justify-between hover:-translate-y-[2px] hover:shadow-lg transition-all duration-200">
                      <div className="space-y-1">
                        <label className="text-xs text-brand-muted uppercase font-bold tracking-wider block">Cap at 80%</label>
                        <span className="text-xs text-brand-muted block">Preserve cycle lifespan</span>
                      </div>
                      <input
                        type="checkbox"
                        checked={chargeLimit80}
                        onChange={(e) => setChargeLimit80(e.target.checked)}
                        disabled={runawayMode}
                        className="h-4 w-4 accent-brand-primary rounded"
                      />
                    </div>

                    <button
                      onClick={() => setRunawayMode(!runawayMode)}
                      className={`p-4 rounded-xl font-bold text-xs uppercase flex flex-col justify-center items-center gap-1 transition-all hover:-translate-y-[2px] hover:shadow-lg ${
                        runawayMode
                          ? "bg-danger text-white border border-danger shadow-md"
                          : "bg-brand-accent/20 text-brand-dark hover:bg-brand-accent/40 hover:text-danger"
                      }`}
                    >
                      <span>{runawayMode ? "Stop Thermal Failure" : "Simulate Runaway"}</span>
                      <span className="text-xs font-normal lowercase">{runawayMode ? "de-activate runaway" : "force thermal spike"}</span>
                    </button>
                  </div>
                </div>

                <div className="bg-white border border-brand-primary/20 rounded-2xl p-6 shadow-sm">
                  <div className="flex justify-between items-center mb-4">
                    <h3 className="text-base font-bold flex items-center gap-2 text-brand-dark">
                      <svg className="w-5 h-5 text-brand-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                      </svg>
                      Delta-Modulation Neural Spike Monitor
                    </h3>
                    <span className="text-xs text-brand-muted bg-brand-accent/30 px-2.5 py-1 rounded-full uppercase tracking-wider font-semibold">
                      Spike Rate Dynamic
                    </span>
                  </div>

                  <div className="space-y-3 font-mono text-xs">
                    {[
                      { label: "Voltage (dV)", key: "voltage" as keyof SpikeEvent },
                      { label: "Current (dI)", key: "current" as keyof SpikeEvent },
                      { label: "Temp (dT)",    key: "temperature" as keyof SpikeEvent },
                    ].map(({ label, key }) => (
                      <div key={key} className="bg-brand-accent/20 p-3 rounded-lg flex items-center justify-between">
                        <span className="w-24 font-bold text-brand-muted uppercase text-xs tracking-wider">{label}</span>
                        <div className="flex gap-1.5 flex-1 justify-end ml-4 overflow-x-hidden">
                          {spikesHistory.slice(0, 15).map((s, idx) => {
                            const val = s[key] as number;
                            return (
                              <div
                                key={idx}
                                className={`h-5 w-5 rounded-full flex items-center justify-center font-bold text-xs transition-all ${
                                  val > 0
                                    ? key === "temperature"
                                      ? "bg-danger text-white animate-bounce"
                                      : "bg-success text-white"
                                    : val < 0
                                    ? "bg-brand-muted text-white"
                                    : "bg-brand-accent/40 text-brand-muted"
                                }`}
                              >
                                {val > 0 ? "+" : val < 0 ? "−" : ""}
                              </div>
                            );
                          })}
                          {spikesHistory.length === 0 && (
                            <span className="text-brand-muted text-xs italic">Awaiting delta spikes...</span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {activeTab === "predictive" && (
              <div className="space-y-6">
                <div className="bg-white border border-brand-primary/20 rounded-2xl p-6 shadow-sm">
                  <h3 className="text-base font-bold mb-4 text-brand-dark">SOH Capacity Degradation Curve</h3>
                  <div className="w-full h-64 bg-brand-bg rounded-xl p-4 flex items-center justify-center relative border border-brand-accent/40">
                    <svg className="w-full h-full" viewBox="0 0 500 200">
                      <defs>
                        <clipPath id="chartClip">
                          <rect x="0" y="0" width="0" height="200" className="animate-draw-clip" />
                        </clipPath>
                      </defs>

                      <line x1="40" y1="10"  x2="40"  y2="170" stroke="#B3CFE5" strokeOpacity="0.4" strokeWidth="1" />
                      <line x1="40" y1="170" x2="480" y2="170" stroke="#B3CFE5" strokeOpacity="0.4" strokeWidth="1" />
                      <line x1="40" y1="90"  x2="480" y2="90"  stroke="#B3CFE5" strokeOpacity="0.4" strokeWidth="1" strokeDasharray="4" />

                      <text x="15" y="15"  fill="#4A7FA7" fontSize="9" fontFamily="monospace">100%</text>
                      <text x="15" y="90"  fill="#4A7FA7" fontSize="9" fontFamily="monospace">85%</text>
                      <text x="15" y="170" fill="#4A7FA7" fontSize="9" fontFamily="monospace">70%</text>
                      <text x="40"  y="185" fill="#4A7FA7" fontSize="9" fontFamily="monospace">0 cycles</text>
                      <text x="260" y="185" fill="#4A7FA7" fontSize="9" fontFamily="monospace">750 cycles</text>
                      <text x="440" y="185" fill="#4A7FA7" fontSize="9" fontFamily="monospace">1500 cycles</text>

                      <g clipPath="url(#chartClip)">
                        {connectToAPI && projectedDecayCurve.length > 0 ? (
                          <path d={getBackendDecayPath()} fill="none" stroke="#1A3D63" strokeWidth="3.5" strokeLinecap="round" />
                        ) : (
                          <>
                            <path d="M 40 15 Q 260 90 480 150" fill="none" stroke="#1A3D63" strokeWidth="3" strokeLinecap="round" />
                            <path d="M 40 15 Q 200 110 480 178" fill="none" stroke="#c0392b" strokeWidth="2" strokeLinecap="round" strokeDasharray="4" />
                          </>
                        )}
                      </g>

                      {chargeCycles > 0 && (
                        <circle
                          cx={40 + (chargeCycles / 1500) * 440}
                          cy={15 + (100 - soh) * 4.5}
                          r="6" fill="#4A7FA7"
                        />
                      )}
                    </svg>

                    <div className="absolute top-4 right-4 flex gap-4 text-xs font-semibold">
                      <span className="flex items-center gap-1.5 text-brand-muted">
                        <span className="h-2 w-2 rounded-full bg-brand-primary" />Normal degradation
                      </span>
                      <span className="flex items-center gap-1.5 text-brand-muted">
                        <span className="h-2 w-2 rounded-full bg-danger" />Fast charge accel.
                      </span>
                      <span className="flex items-center gap-1.5 text-brand-muted">
                        <span className="h-2.5 w-2.5 rounded-full bg-brand-muted" />Current status
                      </span>
                    </div>
                  </div>
                </div>

                <div className="bg-white border border-brand-primary/20 rounded-2xl p-6 shadow-sm">
                  <h3 className="text-base font-bold mb-4 text-brand-dark">Digital Twin Calibration State</h3>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <div className="bg-brand-accent/20 p-4 rounded-xl space-y-3 hover:-translate-y-[2px] hover:shadow-lg transition-all duration-200">
                      <h4 className="text-xs font-bold uppercase text-brand-primary tracking-wider">Physical Cell</h4>
                      <div>
                        <span className="text-xs text-brand-muted block">Measured Temp</span>
                        <span className="text-lg font-bold text-brand-dark">{temperature}°C</span>
                      </div>
                      <div>
                        <span className="text-xs text-brand-muted block">Measured Voltage</span>
                        <span className="text-lg font-bold text-brand-dark">{voltage}V</span>
                      </div>
                    </div>

                    <div className="bg-brand-accent/20 p-4 rounded-xl space-y-3 hover:-translate-y-[2px] hover:shadow-lg transition-all duration-200">
                      <h4 className="text-xs font-bold uppercase text-brand-muted tracking-wider">Twin (Ideal Model)</h4>
                      <div>
                        <span className="text-xs text-brand-muted block">Model Temp</span>
                        <span className="text-lg font-bold text-brand-dark">{twinTemp.toFixed(2)}°C</span>
                      </div>
                      <div>
                        <span className="text-xs text-brand-muted block">Model Voltage</span>
                        <span className="text-lg font-bold text-brand-dark">{twinVoltage.toFixed(3)}V</span>
                      </div>
                    </div>

                    <div className="bg-brand-accent/20 p-4 rounded-xl space-y-3 hover:-translate-y-[2px] hover:shadow-lg transition-all duration-200">
                      <h4 className="text-xs font-bold uppercase text-brand-muted tracking-wider">Model Drift Delta</h4>
                      <div>
                        <span className="text-xs text-brand-muted block">Thermal Delta</span>
                        <span className={`text-lg font-bold ${Math.abs(temperature - twinTemp) > 2.0 ? "text-danger" : "text-success"}`}>
                          {Math.abs(temperature - twinTemp).toFixed(2)}°C
                        </span>
                      </div>
                      <div>
                        <span className="text-xs text-brand-muted block">Voltage Delta</span>
                        <span className="text-lg font-bold text-success">{Math.abs(voltage - twinVoltage).toFixed(3)}V</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {activeTab === "recommendations" && (
              <div className="space-y-6">
                <div className="bg-white border border-brand-primary/20 rounded-2xl p-6 shadow-sm space-y-4">
                  <h3 className="text-base font-bold text-brand-dark">Recommended preservation strategies</h3>
                  <div className="space-y-3">
                    {connectToAPI ? (
                      <>
                        {backendWarnings.map((w, i) => (
                          <div key={i} className="flex gap-3 bg-danger/10 text-danger border border-danger/20 p-4 rounded-xl text-xs">
                            <svg className="w-5 h-5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                            </svg>
                            <div><strong className="block font-semibold mb-1">Safety Alert</strong>{w}</div>
                          </div>
                        ))}
                        {backendRecommendations.map((r, i) => (
                          <div key={i} className="flex gap-3 bg-brand-accent/20 text-brand-dark p-4 rounded-xl text-xs">
                            <svg className="w-5 h-5 text-brand-primary flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                            <div><strong className="block font-semibold mb-1">Preservation Suggestion</strong>{r}</div>
                          </div>
                        ))}
                        {backendRecommendations.length === 0 && backendWarnings.length === 0 && (
                          <span className="text-xs text-brand-muted">Awaiting backend analysis...</span>
                        )}
                      </>
                    ) : (
                      <>
                        {temperature > 35.0 && (
                          <div className="flex gap-3 bg-danger/10 text-danger border border-danger/20 p-4 rounded-xl text-xs">
                            <svg className="w-5 h-5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                            </svg>
                            <div>
                              <strong className="block font-semibold mb-1">Cooling phase recommended</strong>
                              Cell temperature is elevated ({temperature}°C). Restrict fast charging to prevent electrolyte breakdown.
                            </div>
                          </div>
                        )}

                        <div className="flex gap-3 bg-brand-accent/20 text-brand-dark p-4 rounded-xl text-xs hover:-translate-y-[2px] hover:shadow-lg transition-all duration-200">
                          <svg className="w-5 h-5 text-brand-primary flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                          <div>
                            <strong className="block font-semibold mb-1">Charge Limiting (80% SOC cap)</strong>
                            Enabling the 80% charge limit is projected to extend RUL from {rul} to {rul + 450} cycles, slowing active cathode erosion.
                          </div>
                        </div>

                        <div className="flex gap-3 bg-brand-accent/20 text-brand-dark p-4 rounded-xl text-xs hover:-translate-y-[2px] hover:shadow-lg transition-all duration-200">
                          <svg className="w-5 h-5 text-brand-primary flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                          <div>
                            <strong className="block font-semibold mb-1">Constant-Voltage absorption phase optimize</strong>
                            High-current charging sustained for {chargeCycles > 200 ? "42" : "28"} cycles. Transitioning to CV mode earlier reduces grid lattice stresses.
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                </div>

                <div className="bg-white border border-brand-primary/20 rounded-2xl p-6 shadow-sm">
                  <h3 className="text-base font-bold mb-4 flex items-center gap-2 text-brand-dark">
                    <svg className="w-5 h-5 text-brand-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    AI Explorer: Neuromorphic Physics Portal
                  </h3>
                  <div className="space-y-3">
                    {qaData.map((qa, index) => (
                      <div key={index} className="border border-brand-accent rounded-xl overflow-hidden hover:-translate-y-[2px] hover:shadow-lg transition-all duration-200">
                        <button
                          onClick={() => setSelectedQA(selectedQA === index ? null : index)}
                          className="w-full flex justify-between items-center p-4 text-left font-semibold text-xs transition-all hover:bg-brand-accent/20 text-brand-dark bg-brand-accent/10"
                        >
                          <span>{qa.q}</span>
                          <svg className={`w-4 h-4 text-brand-muted transition-transform duration-300 ${selectedQA === index ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                          </svg>
                        </button>
                        {selectedQA === index && (
                          <div className="p-4 bg-white border-t border-brand-accent text-xs leading-relaxed text-brand-muted">
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

          <div className="space-y-6">
            <div className="bg-white border border-brand-primary/20 rounded-2xl p-6 shadow-sm space-y-4">
              <h3 className="text-base font-bold flex items-center gap-2 text-brand-dark">
                <svg className="w-5 h-5 text-brand-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                LIF Neuron State Monitor
              </h3>

              <div className="space-y-4 text-xs">
                <div className="space-y-2">
                  <div className="flex justify-between font-mono">
                    <span className="text-brand-muted">Membrane Potential (V_m):</span>
                    <span className="font-bold text-brand-dark">{membranePotential} / {vThreshold} V</span>
                  </div>
                  <div className="w-full bg-brand-accent/50 h-3 rounded-full overflow-hidden">
                    <div
                      className={`h-full ${hasAnimatedCounters ? "transition-all duration-300" : ""} ${
                        membranePotential > 0.7 ? "bg-danger" : membranePotential > 0.4 ? "bg-brand-muted" : "bg-brand-primary"
                      }`}
                      style={{ width: `${Math.min(100, ((hasAnimatedCounters ? membranePotential : animatedLif) / vThreshold) * 100)}%` }}
                    />
                  </div>
                </div>

                <div className="bg-brand-accent/20 rounded-xl p-3 space-y-1 font-mono text-xs">
                  {[
                    ["Rest Potential:", `${vRest}V`],
                    ["Firing Threshold:", `${vThreshold}V`],
                    ["Temp Spike Weight (w_T):", "+0.55"],
                    ["Current Spike Weight (w_I):", "+0.25"],
                    ["Leak Constant (tau):", "4.0 steps"],
                  ].map(([label, val]) => (
                    <div key={label} className="flex justify-between">
                      <span className="text-brand-muted">{label}</span>
                      <span className="text-brand-dark font-semibold">{val}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="bg-white border border-brand-primary/20 rounded-2xl p-6 shadow-sm space-y-4">
              <h3 className="text-base font-bold text-brand-dark">SNN Alert &amp; Event Feed</h3>
              <div className="space-y-3 max-h-80 overflow-y-auto pr-1">
                {alerts.map((alert) => (
                  <div
                    key={alert.id}
                    className={`p-3 rounded-xl border text-xs space-y-1.5 transition-all duration-300 ${
                      alert.type === "danger"
                        ? "bg-danger/10 border-danger/20 text-danger"
                        : alert.type === "warning"
                        ? "bg-brand-accent/30 border-brand-accent text-brand-primary"
                        : "bg-brand-accent/20 border-brand-accent text-brand-muted"
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
