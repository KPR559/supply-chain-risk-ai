import React, { useEffect, useMemo, useState } from "react";
import { api } from "../api.js";
import TabState from "../components/TabState.jsx";
import ShipmentSummaryCard from "../components/ShipmentSummaryCard.jsx";
import KpiGrid from "../components/KpiGrid.jsx";
import RouteOverviewCard from "../components/RouteOverviewCard.jsx";
import EtaPreviewCard from "../components/EtaPreviewCard.jsx";
import RiskSummaryCard from "../components/RiskSummaryCard.jsx";
import RiskDriversCard from "../components/RiskDriversCard.jsx";
import RecommendationList from "../components/RecommendationList.jsx";
import AiSection from "../components/llm/AiSection.jsx";
import CriticalPreview from "../components/CriticalPreview.jsx";
import ModelDataQuality from "../components/ModelDataQuality.jsx";
import DashboardFooter from "../components/DashboardFooter.jsx";
import AlertDrawer from "../components/AlertDrawer.jsx";
import {
  buildAlertList,
  dismissAlert,
  loadDismissedIds,
  loadReadIds,
  markAlertRead,
  markAllAlertsRead,
} from "../alerts.js";
import { copyShipmentSummary, exportJsonSnapshot, exportNodesCsv, exportPdfReport } from "../exportReport.js";
import { riskBand, situationSummary } from "../models.js";
import { Bell, ChevronDown, Download } from "lucide-react";

function DashboardSkeleton() {
  return (
    <div aria-label="Loading dashboard">
      <div className="sk sk-hero" />
      <div className="kpi-row-grid kpi-grid-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="sk sk-kpi" />
        ))}
      </div>
      <div className="sk sk-tall" />
      <div className="sk sk-tall" />
    </div>
  );
}

export default function PredictionResultsView({ data }) {
  const {
    prediction,
    explanation,
    critical,
    health,
    dq,
    route,
    selectedShipment,
    loading,
    apiError,
    onRetry,
    onNavigate,
    notify,
    lastUpdated,
    alertsOpen,
    setAlertsOpen,
    ai,
    aiRecs,
    aiLoading,
  } = data;
  const [exportOpen, setExportOpen] = useState(false);
  const [metrics, setMetrics] = useState(null);
  const [readIds, setReadIds] = useState(() => loadReadIds());
  const [dismissedIds, setDismissedIds] = useState(() => loadDismissedIds());

  useEffect(() => {
    let alive = true;
    api
      .metrics()
      .then((m) => alive && setMetrics(m))
      .catch(() => alive && setMetrics(null));
    return () => {
      alive = false;
    };
  }, []);

  const nodes = prediction?.node_predictions || [];
  const risk = riskBand(nodes, prediction?.monte_carlo);
  const alerts = useMemo(
    () => buildAlertList({ prediction, explanation, critical }),
    [prediction, explanation, critical]
  );
  const unreadCount = alerts.filter((a) => !dismissedIds.has(a.id) && !readIds.has(a.id)).length;

  // Refresh persisted alert state whenever the drawer opens.
  useEffect(() => {
    if (alertsOpen) {
      setReadIds(loadReadIds());
      setDismissedIds(loadDismissedIds());
    }
  }, [alertsOpen ]);
  const situation = useMemo(
    () => (prediction ? situationSummary({ prediction, critical, selectedShipment }) : ""),
    [prediction, critical, selectedShipment]
  );

  const runExport = async (kind) => {
    setExportOpen(false);
    try {
      if (kind === "pdf") {
        // The LLM report never blocks the export — it is skipped on failure.
        let aiSummary = null;
        try {
          const rep = await api.llmReport(prediction, explanation, critical);
          aiSummary = rep?.markdown || null;
        } catch {
          aiSummary = null;
        }
        await exportPdfReport({ prediction, explanation, critical, selectedShipment, aiSummary });
        if (notify) notify(aiSummary ? "PDF report downloaded (with AI summary)." : "PDF report downloaded.");
      } else if (kind === "json") {
        exportJsonSnapshot({ prediction, explanation, critical, selectedShipment });
        if (notify) notify("JSON snapshot downloaded.");
      } else if (kind === "csv") {
        exportNodesCsv({ prediction, selectedShipment });
        if (notify) notify("Checkpoints CSV downloaded.");
      } else {
        await copyShipmentSummary({ prediction, selectedShipment });
        if (notify) notify("Shipment summary copied to clipboard.");
      }
    } catch (e) {
      if (notify) notify(`Export failed: ${e.message || "unknown error"}`);
    }
  };

  return (
    <div className="view-stack">
      <div className="view-head">
        <div>
          <div className="view-title">Dashboard</div>
          <div className="view-sub">Real-time shipment intelligence and predictive risk overview</div>
        </div>
        {prediction && (
          <div className="view-actions">
            <button
              className="btn ghost"
              onClick={() => setAlertsOpen && setAlertsOpen(true)}
              title="Open alerts"
            >
              <Bell size={14} aria-hidden="true" /> Alerts
              <span className={`count-badge ${unreadCount ? "" : "zero"}`}>{unreadCount}</span>
            </button>
            <div className="export-menu">
              <button
                className="btn ghost"
                onClick={() => setExportOpen((o) => !o)}
                aria-haspopup="menu"
                aria-expanded={exportOpen}
                title="Download this dashboard as a file"
              >
                <Download size={14} aria-hidden="true" /> Export Report
                <ChevronDown size={13} aria-hidden="true" />
              </button>
              {exportOpen && (
                <>
                  <div className="menu-backdrop" onClick={() => setExportOpen(false)} aria-hidden="true" />
                  <div className="export-dropdown" role="menu">
                    <button role="menuitem" onClick={() => runExport("pdf")}>PDF report</button>
                    <button role="menuitem" onClick={() => runExport("json")}>JSON snapshot</button>
                    <button role="menuitem" onClick={() => runExport("csv")}>Checkpoints CSV</button>
                    <button role="menuitem" onClick={() => runExport("copy")}>Copy shipment summary</button>
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </div>

      {apiError && (
        <TabState
          error={apiError}
          onRetry={onRetry}
          loading={false}
          empty={false}
          loadingText=""
          emptyText=""
        />
      )}

      {!apiError && loading && !prediction && <DashboardSkeleton />}

      {!apiError && !loading && !prediction && (
        <>
          <TabState
            loading={false}
            error={null}
            empty
            emptyText="No shipment selected — choose a shipment to view route intelligence and risk predictions."
            loadingText=""
          />
          {onNavigate && (
            <div>
              <button className="btn" onClick={() => onNavigate("shipments")}>
                Select Shipment
              </button>
            </div>
          )}
        </>
      )}

      {prediction && (
        <>
          <ShipmentSummaryCard shipment={selectedShipment} prediction={prediction} risk={risk} />


          <AiSection title="Current situation" text={ai?.situation} loading={aiLoading} />

          <KpiGrid prediction={prediction} critical={critical} />

          <div className="dash-pair">
            <RiskSummaryCard
              prediction={prediction}
              explanation={explanation}
              critical={critical}
              lastUpdated={lastUpdated}
              aiRisk={ai?.risk}
              aiLoading={aiLoading}
            />
            <RecommendationList
              prediction={prediction}
              explanation={explanation}
              critical={critical}
              onNavigate={onNavigate}
              onExport={() => runExport("pdf")}
              aiRecs={aiRecs}
              aiLoading={aiLoading}
            />
            
          </div>
          
          <DashboardFooter
            health={health}
            prediction={prediction}
            lastUpdated={lastUpdated}
            apiError={apiError}
            onRetry={onRetry}
          />
        </>
      )}

      <AlertDrawer
        open={!!alertsOpen}
        onClose={() => setAlertsOpen && setAlertsOpen(false)}
        alerts={alerts}
        onNavigate={onNavigate}
        lastUpdated={lastUpdated}
        readIds={readIds}
        dismissedIds={dismissedIds}
        onRead={(id) => setReadIds(new Set(markAlertRead(id)))}
        onReadAll={(ids) => setReadIds(new Set(markAllAlertsRead(ids)))}
        onDismiss={(id) => setDismissedIds(new Set(dismissAlert(id)))}
      />
    </div>
  );
}
