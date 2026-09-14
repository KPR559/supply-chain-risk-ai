import React, { useMemo, useState } from "react";
import { Plus } from "lucide-react";
import TabState from "../components/TabState.jsx";
import ShipmentFormModal from "../components/ShipmentFormModal.jsx";
import ConfirmationDialog from "../components/ConfirmationDialog.jsx";
import CheckpointTimeline from "../components/CheckpointTimeline.jsx";
import DelayRiskTable from "../components/DelayRiskTable.jsx";
import AlertCard from "../components/AlertCard.jsx";
import { buildAlertList, dismissAlert, loadDismissedIds, loadReadIds, markAlertRead } from "../alerts.js";
import { fmtDays, fmtDelayDays, fmtPct, riskBand, statusClass } from "../models.js";
import { formatDate } from "../utils/helpers.js";

function OpKpi({ label, value, sub, hint }) {
  return (
    <div className="kpi-card" title={hint || undefined}>
      <div className="kpi-top">
        <span className="kpi-label">{label}</span>
      </div>
      <div className="kpi-value">{value}</div>
      {sub && <div className="kpi-sub">{sub}</div>}
    </div>
  );
}

function RowMenu({ onEdit, onDelete }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="row-menu">
      <button
        className="btn ghost mini-btn"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        title="More actions"
      >
        ⋯
      </button>
      {open && (
        <>
          <span className="menu-backdrop" onClick={() => setOpen(false)} aria-hidden="true" />
          <span className="row-dropdown" role="menu">
            <button role="menuitem" onClick={() => { setOpen(false); onEdit(); }}>Edit</button>
            <button role="menuitem" className="danger" onClick={() => { setOpen(false); onDelete(); }}>Delete…</button>
          </span>
        </>
      )}
    </span>
  );
}

export default function ShipmentsView({ data }) {
  const {
    prediction,
    routesMeta,
    shipments,
    selectedId,
    selectedShipment,
    onSelectShipment,
    onAddShipment,
    onEditShipment,
    onDeleteShipment,
    loading,
    apiError,
    onRetry,
    lastUpdated,
    onNavigate,
    notify,
  } = data;

  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [readIds, setReadIds] = useState(() => loadReadIds());
  const [dismissedIds, setDismissedIds] = useState(() => loadDismissedIds());

  const list = shipments || [];
  const mc = prediction?.monte_carlo;
  const nodes = prediction?.node_predictions || [];
  const band = nodes.length ? riskBand(nodes, mc) : null;
  const alerts = useMemo(
    () => buildAlertList({ prediction, explanation: data.explanation, critical: data.critical }),
    [prediction, data.explanation, data.critical]
  );
  const visibleAlerts = alerts.filter((a) => !dismissedIds.has(a.id));

  const submitAdd = (fields) => {
    onAddShipment(fields);
    setAddOpen(false);
    if (notify) notify(`${fields.id} added to the local demo registry.`);
  };
  const submitEdit = (fields) => {
    onEditShipment(editing.id, fields);
    setEditing(null);
    if (notify) notify(`${fields.id} updated.`);
  };
  const confirmDelete = () => {
    onDeleteShipment(deleteTarget.id);
    if (notify) notify(`${deleteTarget.id} removed from the local registry.`);
    setDeleteTarget(null);
  };

  return (
    <div className="view-stack">
      <div className="view-head">
        <div>
          <div className="view-title">Shipment Status</div>
          <div className="view-sub">Track shipment progress, operational status, and checkpoint-level risk.</div>
        </div>
        <button className="btn" onClick={() => setAddOpen(true)}>
          <Plus size={14} aria-hidden="true" /> Add Shipment
        </button>
      </div>

      <section className="panel">
        <div className="panel-head">
          <h2>Current Shipment</h2>
          <div className="head-badges">
            {selectedShipment && (
              <span className={`risk-pill ${statusClass(selectedShipment.status)}`}>
                {selectedShipment.status}
              </span>
            )}
            {band && (
              <span className={`risk-pill ${band.band === "critical" ? "high" : band.band}`}>
                {band.label} risk
              </span>
            )}
            {lastUpdated && <span className="muted">Last updated {lastUpdated}</span>}
          </div>
        </div>
        <TabState
          loading={loading}
          error={apiError}
          onRetry={onRetry}
          empty={!loading && !apiError && !selectedShipment}
          emptyText="No shipments yet — add your first shipment to start tracking."
          loadingText="Loading shipment prediction…"
        />
        {selectedShipment && !loading && !apiError && (
          <>
            <div className="summary-route">
              <span className="summary-stop">
                <span className="summary-stop-label">Origin</span>
                <span className="summary-stop-value">{selectedShipment.origin || "Not available"}</span>
              </span>
              <span className="summary-connector" aria-hidden="true">
                <span className="summary-line" />
                <span className="summary-stop-label">{selectedShipment.location || "En route"}</span>
                <span className="summary-line" />
              </span>
              <span className="summary-stop">
                <span className="summary-stop-label">Destination</span>
                <span className="summary-stop-value">{selectedShipment.destination || "Not available"}</span>
              </span>
            </div>

            <dl className="meta-grid">
              {[
                ["Shipment ID", selectedShipment.id || "Not available", true, "Unique identifier for this shipment record."],
                ["Shipment Type", selectedShipment.type || "Not available", false, "Cargo category declared on the shipment record."],
                ["Transport Mode", selectedShipment.mode || "Not available", false, "Transport modes used along the corridor."],
                ["Departure Date", selectedShipment.departureDate ? formatDate(selectedShipment.departureDate) : "Not available", false, "Planned departure date from the origin."],
                ["Required Delivery Date", selectedShipment.requiredDate ? formatDate(selectedShipment.requiredDate) : "Not available", false, "Customer-required delivery date; drives the deadline miss risk."],
                ["Cargo Priority", selectedShipment.priority || "Not available", false, "Operational priority of the cargo."],
              ].map(([label, value, mono, hint]) => (
                <div key={label} className="meta-cell" title={hint}>
                  <dt>{label}</dt>
                  <dd className={mono ? "mono" : ""}>{value}</dd>
                </div>
              ))}
            </dl>

            <div className="op-grid">
              <OpKpi
                label="Predicted Arrival"
                value={mc?.expected_eta_date ? formatDate(mc.expected_eta_date) : "Not available"}
                sub={mc?.expected_days != null ? `Transit duration ${fmtDays(mc.expected_days)}` : "Risk-adjusted arrival date"}
                hint="Most likely arrival date from the simulated distribution."
              />
              <OpKpi
                label="Expected Delay"
                value={mc?.expected_delay_hours != null ? fmtDelayDays(mc.expected_delay_hours) : "Not available"}
                sub="Compared with the baseline route estimate"
                hint="Expected additional delay compared with the baseline route estimate."
              />
              <OpKpi
                label="Deadline Miss Risk"
                value={mc?.deadline_date != null ? fmtPct(mc?.p_miss_deadline) : "Not available"}
                sub={mc?.deadline_date ? `Customer deadline ${formatDate(mc.deadline_date)}` : "No deadline set"}
                hint="Estimated probability that the shipment will arrive after the customer deadline."
              />
              <OpKpi
                label="P90 Arrival"
                value={mc?.eta_date?.p90 ? formatDate(mc.eta_date.p90) : "Not available"}
                sub="90% probability of arriving on or before this date"
                hint="P90 arrival: 90% probability of arriving on or before this date."
              />
              <OpKpi
                label="Simulations"
                value={mc?.n_simulations?.toLocaleString() ?? "Not available"}
                sub="Monte Carlo runs"
                hint="Number of simulated shipment outcomes used to estimate arrival uncertainty."
              />
            </div>
          </>
        )}
      </section>

      {selectedShipment && !loading && !apiError && (
        <section className="panel">
          <h2>Checkpoint Progress</h2>
          <CheckpointTimeline
            nodes={nodes}
            location={selectedShipment.location}
            onDetails={onNavigate ? () => onNavigate("checkpoints") : null}
          />
        </section>
      )}

      <section className="panel">
        <div className="panel-head">
          <h2>All Shipments ({list.length})</h2>
        </div>
        {list.length === 0 ? (
          <div className="empty-state">
            <div className="empty-title">No shipments yet</div>
            <div className="muted">Add your first shipment to start tracking.</div>
            <button className="btn" onClick={() => setAddOpen(true)} style={{ marginTop: 10 }}>
              <Plus size={14} aria-hidden="true" /> Add Shipment
            </button>
          </div>
        ) : (
          <div className="table-scroll">
            <table className="data-table recent-table">
              <thead>
                <tr>
                  <th>Shipment ID</th>
                  <th>Route</th>
                  <th>Shipment Type</th>
                  <th>Priority</th>
                  <th>Status</th>
                  <th>Current Location</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {list.map((s) => (
                  <tr key={s.id} className={s.id === selectedId ? "highlight-row" : ""}>
                    <td className="mono">{s.id}</td>
                    <td>{s.origin} → {s.destination}</td>
                    <td>{s.type || "Not available"}</td>
                    <td>
                      <span className={`risk-pill ${s.priority === "Critical" ? "high" : s.priority === "High" ? "med" : "low"}`}>
                        {s.priority}
                      </span>
                    </td>
                    <td>
                      <span className={`risk-pill ${statusClass(s.status)}`}>{s.status}</span>
                    </td>
                    <td>{s.location || "Not tracked"}</td>
                    <td className="table-actions">
                      {s.id !== selectedId && (
                        <button className="btn ghost mini-btn" onClick={() => onSelectShipment(s.id)}>
                          View
                        </button>
                      )}
                      <RowMenu onEdit={() => setEditing(s)} onDelete={() => setDeleteTarget(s)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="panel">
        <h2>Delay Risk</h2>
        {apiError && !prediction ? (
          <TabState
            error={apiError}
            onRetry={onRetry}
            loading={false}
            empty={false}
            loadingText=""
            emptyText=""
          />
        ) : loading && !prediction ? (
          <div className="sk sk-line" />
        ) : (
          <DelayRiskTable
            shipments={list}
            selectedId={selectedId}
            prediction={prediction}
            routesMeta={routesMeta}
            onSelect={onSelectShipment}
          />
        )}
      </section>

      <section className="panel">
        <h2>Early Warning Alerts</h2>
        {apiError && !prediction ? (
          <TabState
            error={apiError}
            onRetry={onRetry}
            loading={false}
            empty={false}
            loadingText=""
            emptyText=""
          />
        ) : loading && !prediction ? (
          <>
            <div className="sk sk-line" />
            <div className="sk sk-line" />
          </>
        ) : visibleAlerts.length === 0 ? (
          <div className="empty-state">
            <div className="empty-title">No active alerts</div>
            <div className="muted">All monitored shipment conditions are currently within the expected range.</div>
          </div>
        ) : (
          visibleAlerts.map((a) => (
            <AlertCard
              key={a.id}
              alert={a}
              read={readIds.has(a.id)}
              timeLabel={lastUpdated ? `Observed ${lastUpdated}` : null}
              onRead={(id) => setReadIds(new Set(markAlertRead(id)))}
              onDismiss={(id) => setDismissedIds(new Set(dismissAlert(id)))}
              onAction={onNavigate}
            />
          ))
        )}
      </section>

      <ShipmentFormModal
        key={editing ? editing.id : "new"}
        open={addOpen || Boolean(editing)}
        initial={editing}
        shipments={list}
        routesMeta={routesMeta}
        onSubmit={editing ? submitEdit : submitAdd}
        onClose={() => {
          setAddOpen(false);
          setEditing(null);
        }}
      />

      <ConfirmationDialog
        open={Boolean(deleteTarget)}
        title={`Delete shipment ${deleteTarget?.id || ""}?`}
        message={`${deleteTarget?.id || "This shipment"} and its local record will be removed.`}
        note="Demo registry — this removes the local record only."
        confirmLabel="Delete Shipment"
        onConfirm={confirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
