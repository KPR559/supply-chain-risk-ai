import React, { useCallback, useEffect, useState } from "react";
import { api } from "./api.js";
import { clearSession, getSession, saveSession } from "./auth.js";
import Sidebar from "./components/Sidebar.jsx";
import Header from "./components/Header.jsx";
import LoginView from "./pages/LoginView.jsx";
import OverviewView from "./pages/OverviewView.jsx";
import RouteMapView from "./pages/RouteMapView.jsx";
import RiskRadarView from "./pages/RiskRadarView.jsx";
import SimulatorView from "./pages/SimulatorView.jsx";
import ShipmentsView from "./pages/ShipmentsView.jsx";
import AlertsView from "./pages/AlertsView.jsx";
import AnalyticsView from "./pages/AnalyticsView.jsx";
import ReportsView from "./pages/ReportsView.jsx";
import DataSourcesView from "./pages/DataSourcesView.jsx";
import SettingsView from "./pages/SettingsView.jsx";

const DEFAULT_ROUTE = "suez";
const DEFAULT_NSIM = 10000;

const VIEWS = {
  overview: OverviewView,
  map: RouteMapView,
  radar: RiskRadarView,
  sim: SimulatorView,
  shipments: ShipmentsView,
  alerts: AlertsView,
  analytics: AnalyticsView,
  reports: ReportsView,
  sources: DataSourcesView,
  settings: SettingsView,
};

export default function App() {
  const [user, setUser] = useState(() => getSession()?.username || null);
  const [view, setView] = useState("overview");
  const [route, setRoute] = useState(DEFAULT_ROUTE);
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
    async (routeId, simCount = nSim) => {
      setLoading(true);
      setError(null);
      try {
        const [pred, healthRes, dqRes] = await Promise.all([
          api.predict(routeId, { nSim: simCount }),
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
    loadBase(DEFAULT_ROUTE, nSim);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, loadRoutes]);

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
    setView("overview");
  };

  const selectRoute = (routeId) => {
    setRoute(routeId);
    loadBase(routeId, nSim);
  };

  const ViewComponent = VIEWS[view] || OverviewView;
  const data = {
    prediction,
    explanation,
    critical,
    health,
    dq,
    routesMeta,
    route,
    onRouteChange: selectRoute,
  };

  if (!user) {
    return <LoginView onLogin={handleLogin} />;
  }

  return (
    <div className="app-shell">
      <Sidebar active={view} onSelect={setView} />
      <div className="main-area">
        <Header
          route={route}
          routesMeta={routesMeta}
          onRouteChange={selectRoute}
          loading={loading}
          lastUpdated={lastUpdated}
          onRefresh={() => loadBase(route, nSim)}
          prediction={prediction}
          user={user}
          onLogout={handleLogout}
        />

        {error && <div className="banner error">API error: {error}</div>}
        {loading && !prediction && <div className="loading-bar" />}

        {view === "settings" ? (
          <SettingsView
            data={data}
            nSim={nSim}
            onNSimChange={setNSim}
            onApply={() => loadBase(route, nSim)}
            onReset={() => {
              setNSim(DEFAULT_NSIM);
              loadBase(route, DEFAULT_NSIM);
            }}
          />
        ) : (
          <ViewComponent data={data} />
        )}
      </div>
    </div>
  );
}