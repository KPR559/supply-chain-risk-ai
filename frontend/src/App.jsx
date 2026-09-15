import React, { useCallback, useEffect, useState } from "react";
import { api } from "./api.js";
import { clearSession, getSession, saveSession, updateSessionTokens } from "./auth.js";
import { getStoredTheme, applyTheme } from "./theme.js";
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
import RiskDriversView from "./pages/RiskDriversView.jsx";
import WhatIfView from "./pages/WhatIfView.jsx";
import CompareRoutesView from "./pages/CompareRoutesView.jsx";
import SettingsView from "./pages/SettingsView.jsx";
import SystemSettingsView from "./pages/SystemSettingsView.jsx";
import AccountSettingsView from "./pages/AccountSettingsView.jsx";
import Toast from "./components/Toast.jsx";
import { loadUiPrefs } from "./prefs.js";


const DEFAULT_ROUTE = "asia_europe_suez";
const DEFAULT_NSIM = 10000;

const VIEWS = {
  results: PredictionResultsView,
  map: RouteMapView,
  checkpoints: CheckpointRiskView,
  shipments: ShipmentsView,
  eta: EtaDistributionView,
  contributors: RiskDriversView,
  simulator: WhatIfView,
  compare: CompareRoutesView,
  settings: SettingsView,
  "settings-system": SystemSettingsView,
  "settings-account": AccountSettingsView,
};

export default function App() {
  const [user, setUser] = useState(() => getSession()?.username || null);
  const [token, setToken] = useState(() => getSession()?.token || null);
  const [view, setView] = useState("results");
  const [route, setRoute] = useState(DEFAULT_ROUTE);
  const [shipments, setShipments] = useState(() => loadShipments(user));
  const [selectedId, setSelectedId] = useState(() => loadSelectedId(user));
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
  const [theme, setThemeState] = useState(() => {
    const t = getStoredTheme();
    applyTheme(t);
    return t;
  });
  const [toast, setToast] = useState(null);
  const [alertsOpen, setAlertsOpen] = useState(false);
  const toastTimer = React.useRef(null);

  const toggleTheme = () => {
    const next = theme === "dark" ? "light" : "dark";
    applyTheme(next);
    setThemeState(next);
  };

  const notify = useCallback((msg) => {
    try {
      if (loadUiPrefs().toasts === false) return;
    } catch {
      // fall through — show the toast
    }
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ msg, key: Date.now() });
    toastTimer.current = setTimeout(() => setToast(null), 2800);
  }, []);

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
    // Registry is per account: reload it on every sign-in / account switch.
    const list = loadShipments(user);
    setShipments(list);
    const saved = loadSelectedId(user);
    const initial =
      list.find((s) => s.id === saved) || list[0] || null;
    if (initial) {
      setSelectedId(initial.id);
      saveSelectedId(initial.id, user);
      setRoute(initial.routeId);
      loadBase(initial.routeId, nSim, initial.requiredDate || null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, loadRoutes]);

  const selectShipment = (id, list = shipments) => {
    const found = list.find((s) => s.id === id);
    if (!found) return;
    setSelectedId(found.id);
    saveSelectedId(found.id, user);
    setRoute(found.routeId);
    loadBase(found.routeId, nSim, found.requiredDate || null);
  };

  const addShipment = (fields) => {
    const next = [...shipments, fields];
    setShipments(next);
    saveShipments(next, user);
    selectShipment(fields.id, next);
    setView("shipments");
  };

  const updateShipment = (id, fields) => {
    const next = shipments.map((s) => (s.id === id ? { ...fields, id } : s));
    setShipments(next);
    saveShipments(next, user);
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
    saveShipments(next, user);
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

  const handleLogin = async (username, password, remember) => {
    try {
      const res = await api.login(username, password);
      const access = res.access_token || res.token;
      const refresh = res.refresh_token || null;
      saveSession(res.username || username, access, remember, refresh);
      setUser(res.username || username);
      setToken(access);
      return null;
    } catch (e) {
      if (e.status === 429) return "Too many attempts, please wait a minute.";
      return e.message || "Sign-in failed. Is the API running?";
    }
  };

  const handleRegister = async (username, password) => {
    try {
      await api.register(username, password);
      return null;
    } catch (e) {
      if (e.status === 429) return "Too many attempts, please wait a minute.";
      return e.message || "Sign-up failed. Is the API running?";
    }
  };

  const handleLogout = async () => {
    const sess = getSession();
    const refresh = sess?.refresh_token;
    const toRevoke = refresh || token;
    if (toRevoke) {
      try {
        await api.logout(toRevoke);
      } catch {
        // best effort — session is cleared locally regardless
      }
    }
    clearSession();
    setUser(null);
    setToken(null);
    setPrediction(null);
    setExplanation(null);
    setCritical(null);
    setError(null);
    setView("results");
  };

  const handleDeleteAccount = async () => {
    if (!token) return "Not signed in.";
    try {
      await api.deleteAccount(token);
    } catch (e) {
      return e.message || "Delete failed. Is the API running?";
    }
    clearSession();
    setUser(null);
    setToken(null);
    setPrediction(null);
    setExplanation(null);
    setCritical(null);
    setError(null);
    setView("results");
    return null;
  };

  // Re-validate any restored session against the backend on startup.
  // Only a 401 (unknown/expired token) signs out; network or server errors
  // keep the session so a backend blip never kicks the user to login.
  // If access token expired, try refresh token automatically.
  useEffect(() => {
    const s = getSession();
    if (!s?.token) {
      clearSession();
      setUser(null);
      setToken(null);
      return;
    }
    let alive = true;
    api
      .me(s.token)
      .then((me) => {
        if (!alive) return;
        setUser(me.username || s.username);
        setToken(s.token);
      })
      .catch((e) => {
        if (!alive) return;
        if (e && e.status === 401 && s.refresh_token) {
          // try refresh
          api
            .refresh(s.refresh_token)
            .then((res) => {
              if (!alive) return;
              const newAccess = res.access_token || res.token;
              const newRefresh = res.refresh_token || s.refresh_token;
              updateSessionTokens(newAccess, newRefresh);
              setUser(res.username || s.username);
              setToken(newAccess);
            })
            .catch(() => {
              if (!alive) return;
              clearSession();
              setUser(null);
              setToken(null);
            });
        } else if (e && e.status === 401) {
          clearSession();
          setUser(null);
          setToken(null);
        }
      });
    return () => {
      alive = false;
    };
  }, []);

  const changeSim = (simCount) => {
    setNSim(simCount);
    loadBase(route, simCount, selectedShipment?.requiredDate || null);
  };

  // Apply the saved display density (Settings → Display).
  useEffect(() => {
    try {
      document.body.dataset.density = loadUiPrefs().density || "comfortable";
    } catch {
      // ignore
    }
  }, []);

  const isSettingsSubView = view === "settings-system" || view === "settings-account";
  const sidebarActive = isSettingsSubView ? "settings" : view;

  const handleNavigateSettings = (sub) => {
    if (sub === "system") setView("settings-system");
    else if (sub === "account") setView("settings-account");
    else setView("settings");
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
    nSim,
    onSimChange: changeSim,
    shipments,
    selectedId,
    selectedShipment,
    loading,
    apiError: error,
    lastUpdated,
    user,
    onLogout: handleLogout,
    onDeleteAccount: handleDeleteAccount,
    onNavigate: setView,
    onNavigateSettings: handleNavigateSettings,
    onBackToSettings: () => setView("settings"),
    notify,
    alertsOpen,
    setAlertsOpen,
    onRetry: () => loadBase(route, nSim, selectedShipment?.requiredDate || null),
    onSelectShipment: selectShipment,
    onAddShipment: addShipment,
    onEditShipment: updateShipment,
    onDeleteShipment: deleteShipment,
  };

  if (!user) {
    return <LoginView onLogin={handleLogin} onRegister={handleRegister} />;
  }

  return (
    <div className="app-shell">
      <Sidebar
        active={sidebarActive}
        onSelect={setView}
        user={user}
        onLogout={handleLogout}
        onOpenAlerts={() => {
          setView("results");
          setAlertsOpen(true);
        }}
      />
      <div className="main-area">
        <MobileNav active={sidebarActive} onSelect={setView} onLogout={handleLogout} />
        <Header
          shipments={shipments}
          selectedId={selectedShipment?.id}
          onSelectShipment={selectShipment}
          loading={loading}
          lastUpdated={lastUpdated}
          onRefresh={() => {
            loadBase(route, nSim, selectedShipment?.requiredDate || null);
            notify("Refreshing shipment intelligence…");
          }}
          prediction={prediction}
          theme={theme}
          onToggleTheme={toggleTheme}
        />

        {loading && !prediction && <div className="loading-bar" />}

        <ViewComponent data={data} />
        <Toast toast={toast} />
      </div>
    </div>
  );
}