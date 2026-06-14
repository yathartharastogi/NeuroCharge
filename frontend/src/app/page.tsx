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

  useEffect(() => {
    if (view !== "landing") return;
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-revealed");
          }
        });
      },
      { threshold: 0.1 }
    );
    const elements = document.querySelectorAll(".scroll-reveal");
    elements.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [view]);

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
      q: "Electrolyte Degradation Physics",
      a: "Neuromorphic models predict accelerated SEI layer formation at temperatures above 40°C. AI suggests maintaining cooler operation to extend electrolyte life.",
    },
    {
      q: "Lithium Plating Mechanisms",
      a: "High currents at low temperatures trigger lithium plating on the graphite anode, reducing capacity. Dynamic charge limit capping protects grid boundaries.",
    },
    {
      q: "Thermal Drift Runaway Kinetics",
      a: "Unchecked exothermic cell dynamics trigger self-sustaining thermal degradation cycles. Integrated LIF neurons detect temperature rates of change to trigger emergency coolants.",
    },
  ];

  const scrollToSection = (id: string) => {
    const element = document.getElementById(id);
    if (element) {
      element.scrollIntoView({ behavior: "smooth" });
    }
  };

  if (view === "landing") {
    return (
      <div className="flex flex-col min-h-screen bg-[#080E1A] text-white relative">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_50%,rgba(56,189,248,0.08)_0%,transparent_40%),radial-gradient(circle_at_80%_60%,rgba(239,68,68,0.05)_0%,transparent_40%)] pointer-events-none" />

        <header className="fixed top-0 left-0 right-0 z-50 w-full border-b border-[#1E293B] bg-[#080E1A]/90 backdrop-blur-md px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3 cursor-pointer" onClick={() => setView("landing")}>
            <div className="h-8 w-8 rounded-full bg-[#1E293B] border border-brand-primary flex items-center justify-center text-brand-primary font-bold text-xs tracking-wider">
              NC
            </div>
            <div>
              <h1 className="font-bold text-sm leading-tight tracking-tight text-white uppercase">NeuroCharge SNN PLATFORM</h1>
            </div>
          </div>
          <div className="hidden md:flex items-center gap-8 text-xs font-semibold text-[#94A3B8]">
            <span onClick={() => scrollToSection("features")} className="hover:text-[#38BDF8] cursor-pointer transition-all">Features</span>
            <span onClick={() => scrollToSection("technology")} className="hover:text-[#38BDF8] cursor-pointer transition-all">Technology</span>
            <span onClick={() => scrollToSection("about")} className="hover:text-[#38BDF8] cursor-pointer transition-all">About</span>
          </div>
          <button
            onClick={() => setView("dashboard")}
            className="px-5 py-2.5 bg-[#0F172A] border border-[#1E293B] hover:border-[#38BDF8] text-white hover:text-[#38BDF8] text-xs font-bold uppercase rounded-lg transition-all shadow-[0_0_10px_rgba(56,189,248,0.05)] cursor-pointer"
          >
            Enter Dashboard &gt;
          </button>
        </header>

        <main className="flex-1 max-w-5xl mx-auto px-6 pt-32 pb-16 space-y-24 z-10 w-full">
          <section className="flex flex-col items-center justify-center text-center space-y-8 min-h-[60vh]">
            <h2 className="text-5xl md:text-6xl font-extrabold tracking-tight leading-none text-white uppercase max-w-3xl animate-fade-up delay-100 start-hidden">
              The Future of Battery Intelligence
            </h2>

            <p className="text-sm md:text-base text-brand-muted max-w-2xl leading-relaxed animate-fade-up delay-200 start-hidden">
              Next-generation neuromorphic battery management platform. Advanced SNN-driven analytics for optimized performance and longevity.
            </p>

            <div className="animate-fade-up delay-300 start-hidden pt-4">
              <button
                onClick={() => setView("dashboard")}
                className="px-8 py-3.5 bg-brand-bg border border-brand-primary text-white hover:bg-[#0F172A] text-sm font-bold uppercase rounded-lg transition-all shadow-[0_0_15px_rgba(56,189,248,0.2)] hover:scale-[1.02] cursor-pointer"
              >
                Enter Platform &gt;
              </button>
            </div>
          </section>

          <section id="features" className="scroll-reveal space-y-8 pt-12">
            <div className="text-center">
              <h3 className="text-2xl font-extrabold tracking-wider uppercase text-white">Features</h3>
              <div className="h-1 w-12 bg-[#38BDF8] mx-auto mt-3" />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 w-full">
              <div className="bg-[#0F172A] border border-[#1E293B] p-8 rounded-2xl text-center hover:border-brand-primary/50 hover:shadow-[0_0_20px_rgba(56,189,248,0.05)] hover:-translate-y-1.5 transition-all duration-300 space-y-4 flex flex-col items-center">
                <div className="h-12 w-12 bg-brand-primary/10 text-brand-primary rounded-xl flex items-center justify-center border border-brand-primary/20">
                  <svg className="w-6 h-6 animate-pulse" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                  </svg>
                </div>
                <h4 className="font-bold text-base text-white">Live Monitor</h4>
                <p className="text-xs text-brand-muted leading-relaxed">
                  Real-time SNN monitoring for voltage, temperature, and current spike detection.
                </p>
              </div>

              <div className="bg-[#0F172A] border border-[#1E293B] p-8 rounded-2xl text-center hover:border-brand-primary/50 hover:shadow-[0_0_20px_rgba(56,189,248,0.05)] hover:-translate-y-1.5 transition-all duration-300 space-y-4 flex flex-col items-center">
                <div className="h-12 w-12 bg-brand-primary/10 text-brand-primary rounded-xl flex items-center justify-center border border-brand-primary/20">
                  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                  </svg>
                </div>
                <h4 className="font-bold text-base text-white">Predictive Twin</h4>
                <p className="text-xs text-brand-muted leading-relaxed">
                  AI-driven degradation modeling and simulation for precise lifetime prediction.
                </p>
              </div>

              <div className="bg-[#0F172A] border border-[#1E293B] p-8 rounded-2xl text-center hover:border-brand-primary/50 hover:shadow-[0_0_20px_rgba(56,189,248,0.05)] hover:-translate-y-1.5 transition-all duration-300 space-y-4 flex flex-col items-center">
                <div className="h-12 w-12 bg-brand-primary/10 text-brand-primary rounded-xl flex items-center justify-center border border-brand-primary/20">
                  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                  </svg>
                </div>
                <h4 className="font-bold text-base text-white">AI Preservation</h4>
                <p className="text-xs text-brand-muted leading-relaxed">
                  Smart SNN algorithms for proactive thermal management and charge optimization.
                </p>
              </div>
            </div>
          </section>

          <section id="technology" className="scroll-reveal space-y-8 pt-12">
            <div className="text-center">
              <h3 className="text-2xl font-extrabold tracking-wider uppercase text-white">Understanding EV Battery Intelligence</h3>
              <div className="h-1 w-12 bg-[#38BDF8] mx-auto mt-3" />
            </div>
            <div className="max-w-3xl mx-auto space-y-6 text-sm text-[#94A3B8] leading-relaxed text-center">
              <p>
                Spiking Neural Networks (SNNs) represent the vanguard of neuromorphic computing, mimicking the biology of human neural pathways to process battery sensor inputs as temporal spike events. By translating continuous telemetry—voltage shifts, current draws, and thermal spikes—into discrete delta-modulated triggers, the SNN model operates with near-zero latency. This stateful execution allows the system to run complex predictive algorithms at a fraction of the computational footprint required by traditional state-of-health processors.
              </p>
              <p>
                This stateful monitoring is crucial for early anomaly detection, especially in high-stress charging cycles. By continuously integrating temporal spikes, the Leaky Integrate-and-Fire model identifies thermodynamic anomalies in under a second, stopping potential thermal runaway events before they escalate. Furthermore, these real-time calibration loops align the battery's active output with its digital twin, dynamically adapting charge limits and reducing grid lattice stresses to extend cycle longevity and vehicle health.
              </p>
            </div>
          </section>

          <section id="about" className="scroll-reveal space-y-8 pt-12">
            <div className="text-center">
              <h3 className="text-2xl font-extrabold tracking-wider uppercase text-white">About NeuroCharge</h3>
              <div className="h-1 w-12 bg-[#38BDF8] mx-auto mt-3" />
            </div>
            <div className="max-w-3xl mx-auto space-y-6 text-sm text-[#94A3B8] leading-relaxed text-center">
              <p>
                NeuroCharge was founded on the mission to revolutionize energy storage analytics through neuromorphic computing. By bridging the gap between hardware battery management capabilities and stateful artificial intelligence, our platform delivers real-time prognostic safety checks and lifespan optimizations. We empower EV fleets, energy providers, and grid operators with deep-tech, SNN-driven insights to maximize efficiency, accelerate electrification, and secure long-term battery cell reliability.
              </p>
            </div>
          </section>
        </main>

        <footer className="w-full border-t border-[#1E293B] py-6 text-center text-[10px] text-brand-muted font-medium uppercase tracking-widest z-10">
          &copy; {new Date().getFullYear()} NEUROCHARGE. ALL RIGHTS RESERVED.
        </footer>
      </div>
    );
  }

  return (
    <div className="flex flex-1 min-h-screen bg-[#080E1A] text-white">
      <aside className="w-64 border-r border-[#1E293B] bg-[#080E1A] p-6 flex-col justify-between hidden md:flex">
        <div>
          <div onClick={() => setView("landing")} className="flex items-center gap-3 mb-8 cursor-pointer hover:opacity-80 transition-all">
            <div className="h-8 w-8 rounded-full bg-[#1E293B] border border-brand-primary flex items-center justify-center text-brand-primary font-bold text-xs tracking-wider">NC</div>
            <div>
              <h1 className="font-bold text-sm leading-tight tracking-tight text-white">NeuroCharge</h1>
              <span className="text-[10px] text-brand-muted font-medium uppercase tracking-widest">SNN Platform</span>
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
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-xs transition-all ${
                  activeTab === key
                    ? "bg-[#0F172A] text-white font-semibold border border-brand-primary/20 shadow-[0_0_10px_rgba(56,189,248,0.05)]"
                    : "text-brand-muted hover:bg-[#0F172A]/50 hover:text-white"
                }`}
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">{icon}</svg>
                {label}
              </button>
            ))}
          </nav>

          <div className="mt-8 pt-6 border-t border-[#1E293B] space-y-3">
            <span className="text-[10px] font-bold uppercase tracking-widest text-brand-muted block">Database Integration</span>
            <div className="flex items-center justify-between bg-[#0F172A] border border-[#1E293B] p-3.5 rounded-xl">
              <div className="space-y-0.5">
                <span className="text-[10px] font-semibold text-white block">Live API link</span>
                <span className="text-[9px] text-brand-muted block">Persist records to SQL</span>
              </div>
              <input
                type="checkbox"
                checked={connectToAPI}
                disabled={isAuthenticating}
                onChange={(e) => setConnectToAPI(e.target.checked)}
                className="h-4 w-4 accent-brand-primary border-[#1E293B] rounded bg-[#080E1A]"
              />
            </div>
            {isAuthenticating && <span className="text-[10px] text-brand-muted block animate-pulse font-semibold">Authenticating admin session...</span>}
            {connectionError && <span className="text-[10px] text-danger block font-semibold">Connection failed: API down?</span>}
          </div>
        </div>

        <div className="bg-[#0F172A] border border-[#1E293B] rounded-xl p-4 text-[10px] space-y-3">
          <div className="flex justify-between items-center">
            <span className="text-brand-muted">Link Connection:</span>
            <span className={`font-semibold flex items-center gap-1 ${connectToAPI ? "text-success" : "text-brand-primary"}`}>
              <span className={`h-1.5 w-1.5 rounded-full bg-current ${connectToAPI ? "animate-pulse" : ""}`} />
              {connectToAPI ? "API Streaming" : "Local Sim"}
            </span>
          </div>
          {connectToAPI && (
            <>
              <div className="flex justify-between font-mono">
                <span className="text-brand-muted">API Latency:</span>
                <span className="text-white">{serverLatency !== null ? `${serverLatency.toFixed(2)}ms` : "checking..."}</span>
              </div>
              <div className="flex justify-between font-mono">
                <span className="text-brand-muted">Roundtrip Lag:</span>
                <span className="text-white">{networkLatency !== null ? `${networkLatency}ms` : "checking..."}</span>
              </div>
            </>
          )}
          <div className="flex justify-between items-center">
            <span className="text-brand-muted">SNN Model:</span>
            <span className="font-semibold text-brand-primary">LIF-Thermal v1</span>
          </div>
        </div>
      </aside>

      <main className="flex-1 flex flex-col p-4 md:p-8 space-y-6 overflow-y-auto bg-[#080E1A]">
        {activeTab === "realtime" && (
          <header className="flex justify-between items-center border-b border-[#1E293B] pb-4">
            <div>
              <h2 className="text-xl font-bold tracking-tight text-white">Live Monitor - Neuromorphic Battery Management</h2>
            </div>
            <div className="flex items-center gap-3">
              {runawayMode && (
                <span className="bg-danger text-white px-3 py-1 rounded-full text-[10px] font-semibold uppercase animate-pulse">
                  Runaway Active
                </span>
              )}
              <button
                onClick={handleReset}
                className="px-4 py-2 border border-[#1E293B] hover:border-brand-primary text-white rounded-lg transition-all text-xs font-semibold"
              >
                Reset Simulation
              </button>
            </div>
          </header>
        )}

        {activeTab === "predictive" && (
          <header className="flex justify-between items-center border-b border-[#1E293B] pb-4">
            <div>
              <h2 className="text-xl font-bold tracking-tight text-white">Predictive Twin Analytics</h2>
              <p className="text-xs text-brand-muted">
                Real-time neuromorphic analytics for LFP Battery Pack{" "}
                <code className="bg-[#0F172A] border border-[#1E293B] px-1.5 py-0.5 rounded text-brand-primary font-mono text-[10px]">BAT-NEURO-901</code>
              </p>
            </div>
            <button
              onClick={handleReset}
              className="px-4 py-2 border border-[#1E293B] hover:border-brand-primary text-white rounded-lg transition-all text-xs font-semibold"
            >
              Reset Simulation
            </button>
          </header>
        )}

        {activeTab === "recommendations" && (
          <header className="flex justify-between items-center border-b border-[#1E293B] pb-4">
            <div>
              <h2 className="text-xl font-bold tracking-tight text-white">AI Preservation Strategies</h2>
              <p className="text-xs text-brand-muted">Next-generation neuromorphic battery management platform</p>
            </div>
            <button
              onClick={handleReset}
              className="px-4 py-2 border border-[#1E293B] hover:border-brand-primary text-white rounded-lg transition-all text-xs font-semibold"
            >
              Reset Simulation
            </button>
          </header>
        )}

        <div className="flex md:hidden border border-[#1E293B] rounded-lg bg-[#0F172A] overflow-hidden">
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
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="metric-card bg-[#0F172A] border border-[#1E293B] rounded-2xl p-6 hover:border-brand-primary/50 hover:shadow-[0_0_20px_rgba(56,189,248,0.05)] transition-all duration-300 shadow-sm animate-card-entry delay-stagger-0 flex flex-col items-center justify-between min-h-[200px]">
                    <span className="text-xs text-brand-muted font-bold uppercase tracking-wider block text-center w-full">State of Charge (SOC)</span>
                    <div className="relative w-32 h-32 flex items-center justify-center mx-auto mt-2">
                      <svg className="absolute inset-0 w-full h-full" viewBox="0 0 120 120">
                        <circle cx="60" cy="60" r="48" fill="none" stroke="#1E293B" strokeWidth="8" />
                        <circle cx="60" cy="60" r="48" fill="none" stroke="#38BDF8" strokeWidth="8" strokeDasharray="301.6" strokeDashoffset={301.6 - ((hasAnimatedCounters ? soc : animatedSoc) / 100) * 301.6} strokeLinecap="round" transform="rotate(-90 60 60)" className="transition-all duration-300" />
                      </svg>
                      <div className="flex flex-col items-center justify-center space-y-1 z-10">
                        <svg className="w-5 h-5 text-brand-primary animate-pulse" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a2 2 0 012 2v4a2 2 0 01-2 2H3a2 2 0 01-2-2v-4a2 2 0 012-2z M15 13h1a1 1 0 011 1v2a1 1 0 01-1 1h-1" />
                        </svg>
                        <span className="text-xl font-extrabold tracking-tight text-white">{hasAnimatedCounters ? `${soc.toFixed(0)}%` : `${animatedSoc.toFixed(0)}%`}</span>
                      </div>
                    </div>
                  </div>

                  <div className={`metric-card bg-[#0F172A] border rounded-2xl p-6 hover:border-brand-primary/50 hover:shadow-[0_0_20px_rgba(56,189,248,0.05)] transition-all duration-300 shadow-sm animate-card-entry delay-stagger-1 flex flex-col items-center justify-between min-h-[200px] ${temperature > 40 ? "border-danger/50" : "border-[#1E293B]"}`}>
                    <span className="text-xs text-brand-muted font-bold uppercase tracking-wider block text-center w-full">Cell Temp</span>
                    <div className="flex flex-col items-center justify-center py-2 space-y-2">
                      <svg className="w-10 h-10 text-brand-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19c-1.657 0-3-1.343-3-3V7c0-2.761 2.239-5 5-5s5 2.239 5 5v9c0 1.657-1.343 3-3 3H9z M9 7h6" />
                      </svg>
                      <span className={`text-2xl font-extrabold tracking-tight ${temperature > 40 ? "text-danger" : "text-white"}`}>
                        {hasAnimatedCounters ? `${temperature}°C` : `${animatedTemp.toFixed(1)}°C`}
                      </span>
                    </div>
                    <span className="text-[10px] text-brand-muted text-center block w-full">
                      {runawayMode ? "Critical Rising" : temperature > 32 ? "Warning Threshold" : "Thermal Stable"}
                    </span>
                  </div>

                  <div className="metric-card bg-[#0F172A] border border-[#1E293B] rounded-2xl p-6 hover:border-brand-primary/50 hover:shadow-[0_0_20px_rgba(56,189,248,0.05)] transition-all duration-300 shadow-sm animate-card-entry delay-stagger-2 flex flex-col items-center justify-between min-h-[200px]">
                    <span className="text-xs text-brand-muted font-bold uppercase tracking-wider block text-center w-full">Voltage</span>
                    <div className="flex flex-col items-center justify-center py-2 space-y-2">
                      <svg className="w-10 h-10 text-brand-primary animate-pulse" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                      </svg>
                      <span className="text-2xl font-extrabold tracking-tight text-white">
                        {hasAnimatedCounters ? `${voltage}V` : `${animatedVolt.toFixed(2)}V`}
                      </span>
                    </div>
                    <span className="text-[10px] text-brand-muted text-center block w-full">Cell limit: 4.2V</span>
                  </div>
                </div>

                <div className="bg-[#0F172A] border border-[#1E293B] rounded-2xl p-6 shadow-sm flex flex-col justify-between">
                  <h3 className="text-sm font-bold mb-4 text-white uppercase tracking-wider">Cell Simulation</h3>
                  <div className="w-full h-[220px] bg-[#080E1A]/40 rounded-xl p-4 flex items-center justify-center relative border border-[#1E293B]/40">
                    <svg className="w-full h-full" viewBox="0 0 500 200">
                      <defs>
                        <filter id="simGlow" x="-20%" y="-20%" width="140%" height="140%">
                          <feGaussianBlur stdDeviation="6" result="blur" />
                          <feComposite in="SourceGraphic" in2="blur" operator="over" />
                        </filter>
                      </defs>
                      <rect x="40" y="20" width="410" height="150" rx="15" fill="none" stroke="#38BDF8" strokeWidth="2.5" strokeDasharray="5 5" opacity="0.3" />
                      <path d="M 450 65 A 8 8 0 0 1 458 73 L 458 117 A 8 8 0 0 1 450 125 Z" fill="#38BDF8" opacity="0.6" />
                      <circle cx="245" cy="95" r="16" fill="#38BDF8" fillOpacity="0.2" stroke="#38BDF8" strokeWidth="2" className="animate-pulse" filter="url(#simGlow)" />
                      <circle cx="245" cy="95" r="6" fill="#38BDF8" />
                      
                      <path d="M 60 45 Q 160 55 229 95" fill="none" stroke="#38BDF8" strokeWidth="1.5" opacity="0.4" strokeDasharray="3 3" />
                      <path d="M 60 95 Q 160 95 229 95" fill="none" stroke="#38BDF8" strokeWidth="1.5" opacity="0.4" strokeDasharray="3 3" />
                      <path d="M 60 145 Q 160 135 229 95" fill="none" stroke="#38BDF8" strokeWidth="1.5" opacity="0.4" strokeDasharray="3 3" />
                      
                      <path d="M 261 95 Q 340 55 430 45" fill="none" stroke="#10B981" strokeWidth="1.5" opacity="0.4" strokeDasharray="3 3" />
                      <path d="M 261 95 Q 340 95 430 95" fill="none" stroke="#10B981" strokeWidth="1.5" opacity="0.4" strokeDasharray="3 3" />
                      <path d="M 261 95 Q 340 135 430 145" fill="none" stroke="#10B981" strokeWidth="1.5" opacity="0.4" strokeDasharray="3 3" />
                      
                      <circle cx="120" cy="51" r="3" fill="#38BDF8">
                        <animate attributeName="cx" from="60" to="229" dur="3s" repeatCount="indefinite" />
                        <animate attributeName="cy" from="45" to="95" dur="3s" repeatCount="indefinite" />
                      </circle>
                      <circle cx="160" cy="95" r="3" fill="#38BDF8">
                        <animate attributeName="cx" from="60" to="229" dur="2s" repeatCount="indefinite" />
                      </circle>
                      <circle cx="120" cy="139" r="3" fill="#38BDF8">
                        <animate attributeName="cx" from="60" to="229" dur="3.5s" repeatCount="indefinite" />
                        <animate attributeName="cy" from="145" to="95" dur="3.5s" repeatCount="indefinite" />
                      </circle>
                      <circle cx="340" cy="75" r="3" fill="#10B981">
                        <animate attributeName="cx" from="261" to="430" dur="2.5s" repeatCount="indefinite" />
                        <animate attributeName="cy" from="95" to="45" dur="2.5s" repeatCount="indefinite" />
                      </circle>
                      <circle cx="360" cy="95" r="3" fill="#10B981">
                        <animate attributeName="cx" from="261" to="430" dur="1.8s" repeatCount="indefinite" />
                      </circle>
                      <circle cx="340" cy="115" r="3" fill="#10B981">
                        <animate attributeName="cx" from="261" to="430" dur="3s" repeatCount="indefinite" />
                        <animate attributeName="cy" from="95" to="145" dur="3s" repeatCount="indefinite" />
                      </circle>

                      <text x="245" y="45" textAnchor="middle" fill="#38BDF8" fontSize="9" fontFamily="monospace" letterSpacing="1">Neural Activity</text>
                      <text x="360" y="85" textAnchor="middle" fill="#10B981" fontSize="9" fontFamily="monospace" letterSpacing="1">Energy Flow</text>
                      <text x="245" y="155" textAnchor="middle" fill="#94A3B8" fontSize="9" fontFamily="monospace" letterSpacing="1">Synaptic Weights</text>
                    </svg>
                  </div>

                  <div className="grid grid-cols-2 gap-4 mt-6">
                    <div className="bg-[#080E1A]/60 border border-[#1E293B]/60 p-4 rounded-xl space-y-2">
                      <div className="flex justify-between items-center">
                        <span className="text-[10px] text-brand-muted uppercase font-bold tracking-wider">Current Draw</span>
                        <span className={`text-sm font-extrabold tracking-tight ${current > 0 ? "text-success" : current < 0 ? "text-[#38BDF8]" : "text-white"}`}>
                          {hasAnimatedCounters ? (current > 0 ? `+${current}` : current) : (animatedCurr > 0 ? `+${animatedCurr.toFixed(1)}` : animatedCurr.toFixed(1))}A
                        </span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-[10px] text-brand-muted uppercase font-bold tracking-wider">Predicted SOH</span>
                        <span className="text-sm font-extrabold tracking-tight text-white">
                          {hasAnimatedCounters ? `${soh}%` : `${animatedSoh.toFixed(2)}%`}
                        </span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-[10px] text-brand-muted uppercase font-bold tracking-wider">RUL Projection</span>
                        <span className="text-sm font-extrabold tracking-tight text-white">
                          {hasAnimatedCounters ? `${rul} cycles` : `${Math.round(animatedRul)} cycles`}
                        </span>
                      </div>
                    </div>

                    <div className="bg-[#080E1A]/60 border border-[#1E293B]/60 p-4 rounded-xl flex flex-col justify-between">
                      <div className="flex items-center justify-between">
                        <label className="text-[10px] text-brand-muted uppercase font-bold tracking-wider">Charging State</label>
                        <select
                          value={chargingState}
                          onChange={(e) => { setChargingState(e.target.value as ChargingState); setRunawayMode(false); }}
                          disabled={runawayMode}
                          className="bg-[#080E1A] border border-[#1E293B] rounded-lg px-2 py-1 text-[10px] font-semibold text-white focus:outline-none focus:ring-1 focus:ring-brand-primary"
                        >
                          <option value="charging">Charging</option>
                          <option value="discharging">Discharging</option>
                          <option value="idle">Idle</option>
                        </select>
                      </div>

                      <div className="flex items-center justify-between text-[10px]">
                        <span className="text-brand-muted font-bold uppercase tracking-wider">Fast Charge (40A)</span>
                        <input
                          type="checkbox"
                          checked={fastCharge}
                          onChange={(e) => setFastCharge(e.target.checked)}
                          disabled={chargingState !== "charging" || runawayMode}
                          className="h-3.5 w-3.5 accent-brand-primary rounded bg-[#080E1A]"
                        />
                      </div>

                      <div className="flex items-center justify-between text-[10px]">
                        <span className="text-brand-muted font-bold uppercase tracking-wider">Limit Charge 80%</span>
                        <input
                          type="checkbox"
                          checked={chargeLimit80}
                          onChange={(e) => setChargeLimit80(e.target.checked)}
                          disabled={runawayMode}
                          className="h-3.5 w-3.5 accent-brand-primary rounded bg-[#080E1A]"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 flex gap-4">
                    <button
                      onClick={() => setRunawayMode(!runawayMode)}
                      className={`flex-1 py-3.5 rounded-xl font-bold text-xs uppercase transition-all border ${
                        runawayMode
                          ? "bg-danger text-white border-danger shadow-[0_0_15px_rgba(239,68,68,0.2)]"
                          : "bg-[#080E1A]/40 text-[#94A3B8] border-[#1E293B] hover:border-danger hover:text-danger"
                      }`}
                    >
                      {runawayMode ? "Stop Thermal Failure" : "Simulate Runaway"}
                    </button>
                  </div>
                </div>

                <div className="bg-[#0F172A] border border-[#1E293B] rounded-2xl p-6 shadow-sm">
                  <div className="flex justify-between items-center mb-4">
                    <h3 className="text-sm font-bold text-white uppercase tracking-wider">Delta-Modulation Neural Spike Monitor</h3>
                    <span className="text-[9px] text-brand-primary bg-brand-primary/10 border border-brand-primary/20 px-2 py-0.5 rounded-full uppercase tracking-wider font-semibold">
                      Spike Rate Dynamic
                    </span>
                  </div>

                  <div className="space-y-3 font-mono text-xs">
                    {[
                      { label: "Voltage (dV)", key: "voltage" as keyof SpikeEvent },
                      { label: "Current (dI)", key: "current" as keyof SpikeEvent },
                      { label: "Temp (dT)",    key: "temperature" as keyof SpikeEvent },
                    ].map(({ label, key }) => (
                      <div key={key} className="bg-[#080E1A]/60 border border-[#1E293B]/40 p-3 rounded-lg flex items-center justify-between">
                        <span className="w-24 font-bold text-brand-muted uppercase text-[10px] tracking-wider">{label}</span>
                        <div className="flex gap-1.5 flex-1 justify-end ml-4 overflow-x-hidden">
                          {spikesHistory.slice(0, 15).map((s, idx) => {
                            const val = s[key] as number;
                            return (
                              <div
                                key={idx}
                                className={`h-5 w-5 rounded-full flex items-center justify-center font-bold text-[10px] transition-all ${
                                  val > 0
                                    ? key === "temperature"
                                      ? "bg-danger text-white animate-bounce"
                                      : "bg-success text-white"
                                    : val < 0
                                    ? "bg-brand-muted text-white"
                                    : "bg-[#1E293B] text-brand-muted"
                                }`}
                              >
                                {val > 0 ? "+" : val < 0 ? "−" : ""}
                              </div>
                            );
                          })}
                          {spikesHistory.length === 0 && (
                            <span className="text-brand-muted text-[10px] italic">Awaiting delta spikes...</span>
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
                <div className="bg-[#0F172A] border border-[#1E293B] rounded-2xl p-6 shadow-sm">
                  <h3 className="text-sm font-bold mb-4 text-white uppercase tracking-wider">SOH Capacity Degradation Curve</h3>
                  <div className="w-full h-64 bg-[#080E1A]/40 rounded-xl p-4 flex items-center justify-center relative border border-[#1E293B]/40">
                    <svg className="w-full h-full" viewBox="0 0 500 200">
                      <defs>
                        <clipPath id="chartClip">
                          <rect x="0" y="0" width="0" height="200" className="animate-draw-clip" />
                        </clipPath>
                        <filter id="neonBlueGlow" x="-20%" y="-20%" width="140%" height="140%">
                          <feGaussianBlur stdDeviation="4" result="blur" />
                          <feComposite in="SourceGraphic" in2="blur" operator="over" />
                        </filter>
                      </defs>

                      <line x1="40" y1="10"  x2="40"  y2="170" stroke="#1E293B" strokeWidth="1" />
                      <line x1="40" y1="170" x2="480" y2="170" stroke="#1E293B" strokeWidth="1" />
                      <line x1="40" y1="90"  x2="480" y2="90"  stroke="#1E293B" strokeWidth="1" strokeDasharray="4" />

                      <text x="15" y="15"  fill="#94A3B8" fontSize="8" fontFamily="monospace">100%</text>
                      <text x="15" y="90"  fill="#94A3B8" fontSize="8" fontFamily="monospace">85%</text>
                      <text x="15" y="170" fill="#94A3B8" fontSize="8" fontFamily="monospace">70%</text>
                      <text x="40"  y="182" fill="#94A3B8" fontSize="8" fontFamily="monospace">0 cycles</text>
                      <text x="260" y="182" fill="#94A3B8" fontSize="8" fontFamily="monospace">750 cycles</text>
                      <text x="440" y="182" fill="#94A3B8" fontSize="8" fontFamily="monospace">1500 cycles</text>

                      <g clipPath="url(#chartClip)">
                        {connectToAPI && projectedDecayCurve.length > 0 ? (
                          <path d={getBackendDecayPath()} fill="none" stroke="#38BDF8" strokeWidth="3" strokeLinecap="round" filter="url(#neonBlueGlow)" />
                        ) : (
                          <>
                            <path d="M 40 15 Q 260 90 480 150" fill="none" stroke="#38BDF8" strokeWidth="3.5" strokeLinecap="round" filter="url(#neonBlueGlow)" />
                            <path d="M 40 15 Q 200 110 480 178" fill="none" stroke="#EF4444" strokeWidth="2.5" strokeLinecap="round" strokeDasharray="5" />
                          </>
                        )}
                      </g>

                      {chargeCycles > 0 && (
                        <circle
                          cx={40 + (chargeCycles / 1500) * 440}
                          cy={15 + (100 - soh) * 4.5}
                          r="6" fill="#38BDF8" filter="url(#neonBlueGlow)"
                        />
                      )}
                    </svg>

                    <div className="absolute top-4 right-4 flex gap-4 text-[9px] font-semibold uppercase tracking-wider">
                      <span className="flex items-center gap-1.5 text-brand-muted">
                        <span className="h-2 w-2 rounded-full bg-brand-primary" />Actual degradation
                      </span>
                      <span className="flex items-center gap-1.5 text-brand-muted">
                        <span className="h-2 w-2 rounded-full bg-danger" />Predicted degradation (Fast Charge)
                      </span>
                      <span className="flex items-center gap-1.5 text-brand-muted">
                        <span className="h-2 w-2 rounded-full bg-brand-muted" />Current status
                      </span>
                    </div>
                  </div>
                </div>

                <div className="bg-[#0F172A] border border-[#1E293B] rounded-2xl p-6 shadow-sm">
                  <h3 className="text-sm font-bold mb-4 text-white uppercase tracking-wider">Digital Twin Calibration State</h3>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <div className="bg-[#080E1A]/40 border border-[#1E293B] p-4 rounded-xl space-y-3 hover:border-brand-primary/40 transition-all duration-300">
                      <h4 className="text-[10px] font-bold uppercase text-brand-primary tracking-wider">Physical Cell</h4>
                      <div>
                        <span className="text-[10px] text-brand-muted block">Measured Temp</span>
                        <span className="text-lg font-bold text-white">{temperature}°C</span>
                      </div>
                      <div>
                        <span className="text-[10px] text-brand-muted block">Measured Voltage</span>
                        <span className="text-lg font-bold text-white">{voltage}V</span>
                      </div>
                    </div>

                    <div className="bg-[#080E1A]/40 border border-[#1E293B] p-4 rounded-xl space-y-3 hover:border-brand-primary/40 transition-all duration-300">
                      <h4 className="text-[10px] font-bold uppercase text-brand-muted tracking-wider">Twin (Ideal Model)</h4>
                      <div>
                        <span className="text-[10px] text-brand-muted block">Model Temp</span>
                        <span className="text-lg font-bold text-white">{twinTemp.toFixed(2)}°C</span>
                      </div>
                      <div>
                        <span className="text-[10px] text-brand-muted block">Model Voltage</span>
                        <span className="text-lg font-bold text-white">{twinVoltage.toFixed(3)}V</span>
                      </div>
                    </div>

                    <div className={`bg-[#080E1A]/40 border p-4 rounded-xl space-y-3 hover:border-brand-primary/40 transition-all duration-300 ${Math.abs(temperature - twinTemp) > 2.0 ? "border-danger/40" : "border-[#1E293B]"}`}>
                      <div className="flex justify-between items-center">
                        <h4 className="text-[10px] font-bold uppercase text-brand-muted tracking-wider">Model Drift Delta</h4>
                        <span className={`h-2 w-2 rounded-full ${Math.abs(temperature - twinTemp) > 2.0 ? "bg-danger animate-pulse" : "bg-success"}`} />
                      </div>
                      <div>
                        <span className="text-[10px] text-brand-muted block">Thermal Delta</span>
                        <span className={`text-lg font-bold ${Math.abs(temperature - twinTemp) > 2.0 ? "text-danger" : "text-white"}`}>
                          {Math.abs(temperature - twinTemp).toFixed(2)}°C
                        </span>
                      </div>
                      <div>
                        <span className="text-[10px] text-brand-muted block">Voltage Delta</span>
                        <span className="text-lg font-bold text-success">{Math.abs(voltage - twinVoltage).toFixed(3)}V</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {activeTab === "recommendations" && (
              <div className="space-y-6">
                <div className="bg-[#0F172A] border border-[#1E293B] rounded-2xl p-6 shadow-sm space-y-4">
                  <h3 className="text-sm font-bold text-white uppercase tracking-wider">Recommended Preservation Strategies</h3>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <div className="bg-[#080E1A]/40 border border-[#1E293B] p-5 rounded-xl space-y-4 hover:border-brand-primary/40 transition-all flex flex-col justify-between">
                      <div className="space-y-2">
                        <div className="flex justify-between items-center">
                          <span className="text-[10px] text-brand-muted uppercase font-bold tracking-wider">Thermal Management</span>
                          <span className={`h-2.5 w-2.5 rounded-full ${temperature > 35.0 ? "bg-danger animate-pulse" : "bg-success"}`} />
                        </div>
                        <div className="text-xs text-white">Target Temp: <strong className="font-semibold">&lt;30°C</strong></div>
                        <div className="text-[10px] text-brand-muted leading-relaxed">
                          {temperature > 35.0 ? "Active cooling triggers recommended due to temperature anomalies." : "Thermal limits stable. Active cooling idle."}
                        </div>
                      </div>
                      <button className="w-full py-2 bg-[#0F172A] border border-[#1E293B] hover:border-danger hover:text-danger text-white text-[10px] font-bold uppercase rounded-lg transition-all">
                        Activate Cooling
                      </button>
                    </div>

                    <div className="bg-[#080E1A]/40 border border-[#1E293B] p-5 rounded-xl space-y-4 hover:border-brand-primary/40 transition-all flex flex-col justify-between">
                      <div className="space-y-2">
                        <div className="flex justify-between items-center">
                          <span className="text-[10px] text-brand-muted uppercase font-bold tracking-wider">Cycle Optimization</span>
                          <span className="h-2.5 w-2.5 rounded-full bg-success" />
                        </div>
                        <div className="text-xs text-white">Charge Limit: <strong className="font-semibold">80%</strong></div>
                        <div className="text-[10px] text-brand-muted leading-relaxed">
                          Applying an 80% charge limit protects cycle lifespan from degradation stresses.
                        </div>
                      </div>
                      <button className="w-full py-2 bg-[#0F172A] border border-[#1E293B] hover:border-success hover:text-success text-white text-[10px] font-bold uppercase rounded-lg transition-all">
                        Adjust Profile
                      </button>
                    </div>

                    <div className="bg-[#080E1A]/40 border border-[#1E293B] p-5 rounded-xl space-y-4 hover:border-brand-primary/40 transition-all flex flex-col justify-between">
                      <div className="space-y-2">
                        <div className="flex justify-between items-center">
                          <span className="text-[10px] text-brand-muted uppercase font-bold tracking-wider">Stress Reduction</span>
                          <span className="h-2.5 w-2.5 rounded-full bg-brand-primary" />
                        </div>
                        <div className="text-xs text-white">Discharge Rate: <strong className="font-semibold">0.5C</strong></div>
                        <div className="text-[10px] text-brand-muted leading-relaxed">
                          Limits active anode polarization stresses during constant current draw.
                        </div>
                      </div>
                      <button className="w-full py-2 bg-[#0F172A] border border-[#1E293B] hover:border-brand-primary hover:text-brand-primary text-white text-[10px] font-bold uppercase rounded-lg transition-all">
                        Enable Limiter
                      </button>
                    </div>
                  </div>

                  <div className="space-y-3 pt-4 border-t border-[#1E293B]">
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
                          <div key={i} className="flex gap-3 bg-[#0F172A] border border-[#1E293B] text-white p-4 rounded-xl text-xs">
                            <svg className="w-5 h-5 text-brand-primary flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                            <div><strong className="block font-semibold mb-1">Preservation Suggestion</strong>{r}</div>
                          </div>
                        ))}
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
                      </>
                    )}
                  </div>
                </div>

                <div className="bg-[#0F172A] border border-[#1E293B] rounded-2xl p-6 shadow-sm">
                  <h3 className="text-sm font-bold mb-4 flex items-center gap-2 text-white uppercase tracking-wider">
                    AI Explorer
                  </h3>
                  <div className="space-y-3">
                    {qaData.map((qa, index) => (
                      <div key={index} className="border border-[#1E293B] rounded-xl overflow-hidden hover:border-brand-primary/40 transition-all duration-300">
                        <button
                          onClick={() => setSelectedQA(selectedQA === index ? null : index)}
                          className="w-full flex justify-between items-center p-4 text-left font-semibold text-xs transition-all hover:bg-[#080E1A]/40 text-white bg-[#080E1A]/20"
                        >
                          <span>{qa.q}</span>
                          <svg className={`w-4 h-4 text-brand-muted transition-transform duration-300 ${selectedQA === index ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                          </svg>
                        </button>
                        {selectedQA === index && (
                          <div className="p-4 bg-[#080E1A]/60 border-t border-[#1E293B] text-xs leading-relaxed text-brand-muted">
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
            <div className="bg-[#0F172A] border border-[#1E293B] rounded-2xl p-6 shadow-sm space-y-4">
              <h3 className="text-sm font-bold flex items-center gap-2 text-white uppercase tracking-wider">
                LIF Neuron State Monitor
              </h3>

              <div className="space-y-4 text-xs">
                <div className="space-y-2">
                  <div className="flex justify-between font-mono text-[10px]">
                    <span className="text-brand-muted">Membrane Potential (V_m):</span>
                    <span className="font-bold text-white">{membranePotential} / {vThreshold} V</span>
                  </div>
                  <div className="w-full bg-[#080E1A] h-2.5 rounded-full overflow-hidden border border-[#1E293B]">
                    <div
                      className={`h-full ${hasAnimatedCounters ? "transition-all duration-300" : ""} ${
                        membranePotential > 0.7 ? "bg-danger" : membranePotential > 0.4 ? "bg-brand-muted" : "bg-brand-primary"
                      }`}
                      style={{ width: `${Math.min(100, ((hasAnimatedCounters ? membranePotential : animatedLif) / vThreshold) * 100)}%` }}
                    />
                  </div>
                </div>

                <div className="bg-[#080E1A]/40 border border-[#1E293B] rounded-xl p-3.5 space-y-1.5 font-mono text-[10px]">
                  {[
                    ["Rest Potential:", `${vRest}V`],
                    ["Firing Threshold:", `${vThreshold}V`],
                    ["Temp Spike Weight (w_T):", "+0.55"],
                    ["Current Spike Weight (w_I):", "+0.25"],
                    ["Leak Constant (tau):", "4.0 steps"],
                  ].map(([label, val]) => (
                    <div key={label} className="flex justify-between">
                      <span className="text-brand-muted">{label}</span>
                      <span className="text-white font-semibold">{val}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="bg-[#0F172A] border border-[#1E293B] rounded-2xl p-6 shadow-sm space-y-4">
              <h3 className="text-sm font-bold text-white uppercase tracking-wider">SNN Alert &amp; Event Feed</h3>
              <div className="space-y-3 max-h-80 overflow-y-auto pr-1">
                {alerts.map((alert) => (
                  <div
                    key={alert.id}
                    className={`p-3.5 rounded-xl border text-[10px] space-y-1.5 transition-all duration-300 ${
                      alert.type === "danger"
                        ? "bg-danger/10 border-danger/20 text-danger"
                        : alert.type === "warning"
                        ? "bg-brand-primary/10 border-brand-primary/20 text-brand-primary"
                        : "bg-[#080E1A]/40 border-[#1E293B] text-brand-muted"
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
