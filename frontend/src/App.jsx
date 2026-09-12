import React, { useCallback, useEffect, useState } from "react";
import { api } from "./api.js";
import { clearSession, getSession, saveSession } from "./auth.js";
import {
  loadSelectedId,
  loadShipments,
  saveSelectedId,
  saveShipments,
} from "./shipments.js";
import Sidebar from "./components/Sidebar.jsx";
import MobileNav from "./components/MobileNav.jsx";
import Header from "./components/Header.jsx";
import LoginView from "./pages/LoginView.jsx";
import PredictionResultsView from "./pages/PredictionResultsView.jsx";
import RouteMapView from "./pages/RouteMapView.jsx";
import CheckpointRiskView from "./pages/CheckpointRiskView.jsx";
import ShipmentsView from "./pages/ShipmentsView.jsx";
import EtaDistributionView from "./pages/EtaDistributionView.jsx";
import DeadlineRiskView from "./pages/DeadlineRiskView.jsx";
import CriticalCheckpointsView from "./pages/CriticalCheckpointsView.jsx";
import RiskContributorsView from "./pages/RiskContributorsView.jsx";
import WhatIfView from "./pages/WhatIfView.jsx";
import CompareRoutesView from "./pages/CompareRoutesView.jsx";
import ChartsGraphsView from "./pages/ChartsGraphsView.jsx";

const DEFAULT_ROUTE = "suez";
const DEFAULT_NSIM = 10000;

const VIEWS = {
  results: PredictionResultsView,
  map: RouteMapView,
  checkpoints: CheckpointRiskView,
  shipments: ShipmentsView,
  eta: EtaDistributionView,
  deadline: DeadlineRiskView,
  critical: CriticalCheckpointsView,
  contributors: RiskContributorsView,
  simulator: WhatIfView,
  compare: CompareRoutesView,
  charts: ChartsGraphsView,
};

export default function App() {
  const [user, setUser] = useState(() => getSession()?.username || null);
  const [view, setView] = useState("results");
  const [route, setRoute] = useState(DEFAULT_ROUTE);
  const [shipments, setShipments] = useState(() => loadShipments());
  const [selectedId, setSelectedId] = useState(() => loadSelectedId());
  const [nSim, setNSim] = useState(DEFAULT_NSIM);
  const [routesMeta, setRoutesMeta] = useState([]);
  const [prediction, setPrediction] = useState(null);
  const [explanation, setExplanation] = useState(null);
  const [critical, setCritical] = useState(null);
  const [health, setHealth] = useState(null);
  const [dq, setDq] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);

  const loadRoutes = useCallback(async () => {
    try {
      const r = await api.routes();
      setRoutesMeta(r.routes || []);
    } catch (e) {
      console.warn("routes meta unavailable", e);
    }
  }, []);

  const loadBase = useCallback(
    async (routeId, simCount = nSim, deadlineDate = null) => {
      setLoading(true);
      setError(null);
      try {
        const [pred, healthRes, dqRes] = await Promise.all([
          api.predict(routeId, { nSim: simCount, deadlineDate }),
          api.health().catch(() => null),
          api.dataQuality().catch(() => null),
        ]);
        setPrediction(pred);
        setHealth(healthRes);
        setDq(dqRes);
        setLastUpdated(new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }));

        const sid = pred.shipment_id;
        const [expl, crit] = await Promise.all([
          api.explain(sid),
          api.critical(sid),
        ]);
        setExplanation(expl);
        setCritical(crit);
      } catch (e) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    },
    [nSim]
  );

  useEffect(() => {
    if (!user) return;
    loadRoutes();
    const list = shipments;
    const initial =
      list.find((s) => s.id === selectedId) || list[0] || null;
    if (initial) {
      setSelectedId(initial.id);
      saveSelectedId(initial.id);
      setRoute(initial.routeId);
      loadBase(initial.routeId, nSim, initial.requiredDate || null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, loadRoutes]);

  const selectShipment = (id, list = shipments) => {
    const found = list.find((s) => s.id === id);
    if (!found) return;
    setSelectedId(found.id);
    saveSelectedId(found.id);
    setRoute(found.routeId);
    loadBase(found.routeId, nSim, found.requiredDate || null);
  };

  const addShipment = (fields) => {
    const next = [...shipments, fields];
    setShipments(next);
    saveShipments(next);
    selectShipment(fields.id, next);
    setView("shipments");
  };

  const updateShipment = (id, fields) => {
    const next = shipments.map((s) => (s.id === id ? { ...fields, id } : s));
    setShipments(next);
    saveShipments(next);
    if (id === selectedId) {
      const updated = next.find((s) => s.id === id);
      if (updated) {
        setRoute(updated.routeId);
        loadBase(updated.routeId, nSim, updated.requiredDate || null);
      }
    }
  };

  const deleteShipment = (id) => {
    const next = shipments.filter((s) => s.id !== id);
    setShipments(next);
    saveShipments(next);
    if (id === selectedId) {
      if (next.length > 0) {
        selectShipment(next[0].id, next);
      } else {
        setSelectedId(null);
        setPrediction(null);
        setExplanation(null);
        setCritical(null);
      }
    }
  };

  const selectedShipment =
    shipments.find((s) => s.id === selectedId) || shipments[0] || null;

  const handleLogin = (username) => {
    saveSession(username);
    setUser(username);
  };

  const handleLogout = () => {
    clearSession();
    setUser(null);
    setPrediction(null);
    setExplanation(null);
    setCritical(null);
    setError(null);
    setView("results");
  };

  const ViewComponent = VIEWS[view] || PredictionResultsView;
  const data = {
    prediction,
    explanation,
    critical,
    health,
    dq,
    routesMeta,
    route,
    shipments,
    selectedId,
    selectedShipment,
    loading,
    apiError: error,
    onRetry: () => loadBase(route, nSim, selectedShipment?.requiredDate || null),
    onSelectShipment: selectShipment,
    onAddShipment: addShipment,
    onEditShipment: updateShipment,
    onDeleteShipment: deleteShipment,
  };

  if (!user) {
    return <LoginView onLogin={handleLogin} />;
  }

  return (
    <div className="app-shell">
      <Sidebar active={view} onSelect={setView} user={user} onLogout={handleLogout} />
      <div className="main-area">
        <MobileNav active={view} onSelect={setView} onLogout={handleLogout} />
        <Header
          shipments={shipments}
          selectedId={selectedShipment?.id}
          onSelectShipment={selectShipment}
          loading={loading}
          lastUpdated={lastUpdated}
          onRefresh={() => loadBase(route, nSim, selectedShipment?.requiredDate || null)}
          prediction={prediction}
        />

        {loading && !prediction && <div className="loading-bar" />}

        <ViewComponent data={data} />
      </div>
    </div>
  );
}