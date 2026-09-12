import React, { useState } from "react";
import RecentShipments from "../components/RecentShipments.jsx";
import CheckpointCards from "../components/CheckpointCards.jsx";
import AlertsPanel from "../components/AlertsPanel.jsx";
import TabState from "../components/TabState.jsx";
import {
  blankShipment,
  PRIORITIES,
  ROUTE_IDS,
  STATUSES,
} from "../shipments.js";
import {
  delayDaysFromHours,
  formatDate,
  routeDisplayName,
} from "../utils/helpers.js";

const FIELD_DEFS = [
  ["id", "Shipment ID", "text", "SHP004"],
  ["origin", "Origin", "text", "Frankfurt, Germany"],
  ["destination", "Destination", "text", "Mumbai, India"],
  ["type", "Shipment Type", "text", "Automotive Parts"],
  ["mode", "Transport Mode", "text", "Sea + Road"],
  ["departureDate", "Departure Date", "date", ""],
  ["etaDate", "Expected Arrival Date", "date", ""],
  ["requiredDate", "Required Delivery Date", "date", ""],
  ["location", "Current Location", "text", "Hamburg Port"],
];

const INFO_ROWS = [
  ["id", "Shipment ID"],
  ["origin", "Origin"],
  ["destination", "Destination"],
  ["type", "Shipment Type"],
  ["mode", "Transport Mode"],
  ["departureDate", "Departure Date", true],
  ["etaDate", "Expected Arrival Date", true],
  ["requiredDate", "Required Delivery Date", true],
  ["priority", "Cargo Priority"],
  ["location", "Current Location"],
  ["status", "Current Status"],
];

function ShipmentForm({ shipments, routesMeta, initial, onSubmit, onCancel }) {
  const isEdit = Boolean(initial);
  const [form, setForm] = useState(() => (initial ? { ...initial } : blankShipment()));
  const [errors, setErrors] = useState({});

  const set = (key, value) => {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((e) => ({ ...e, [key]: null }));
  };

  const routeName = (rid) =>
    routesMeta.find((r) => r.route_id === rid)?.name ||
    routeDisplayName(rid);

  const submit = (e) => {
    e.preventDefault();
    const errs = {};
    const id = form.id.trim();
    if (!id) errs.id = "Shipment ID is required.";
    else if (
      !isEdit &&
      shipments.some((s) => s.id.toLowerCase() === id.toLowerCase())
    )
      errs.id = "This Shipment ID already exists.";
    if (!form.origin.trim()) errs.origin = "Origin is required.";
    if (!form.destination.trim()) errs.destination = "Destination is required.";
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;
    onSubmit({
      ...form,
      id,
      origin: form.origin.trim(),
      destination: form.destination.trim(),
      type: form.type.trim(),
      mode: form.mode.trim(),
      location: form.location.trim(),
    });
  };

  return (
    <form className="panel ship-form" onSubmit={submit}>
      <h2>{isEdit ? `Edit Shipment ${initial.id}` : "Add Shipment"}</h2>
      <div className="form-grid">
        {FIELD_DEFS.map(([key, label, type, placeholder]) => (
          <label key={key} className="form-field">
            <span>{label}</span>
            <input
              type={type}
              value={form[key]}
              placeholder={placeholder}
              disabled={isEdit && key === "id"}
              title={isEdit && key === "id" ? "Shipment ID cannot be changed" : undefined}
              onChange={(e) => set(key, e.target.value)}
            />
            {errors[key] && <em className="form-error">{errors[key]}</em>}
          </label>
        ))}
        <label className="form-field">
          <span>Cargo Priority</span>
          <select value={form.priority} onChange={(e) => set("priority", e.target.value)}>
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
        </label>
        <label className="form-field">
          <span>Current Status</span>
          <select value={form.status} onChange={(e) => set("status", e.target.value)}>
            {STATUSES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </label>
        <label className="form-field">
          <span>Corridor Route (for prediction)</span>
          <select value={form.routeId} onChange={(e) => set("routeId", e.target.value)}>
            {ROUTE_IDS.map((r) => (
              <option key={r} value={r}>{routeName(r)}</option>
            ))}
          </select>
        </label>
      </div>
      <div className="form-actions">
        <button className="btn" type="submit">{isEdit ? "Save changes" : "Add shipment"}</button>
        <button className="btn ghost" type="button" onClick={onCancel}>Cancel</button>
      </div>
    </form>
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
  } = data;
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const editingShipment = editingId ? list.find((s) => s.id === editingId) || null : null;

  const openAdd = () => {
    setEditingId(null);
    setShowForm((v) => !v);
  };
  const openEdit = (id) => {
    setShowForm(false);
    setEditingId(id);
  };
  const closeForm = () => {
    setShowForm(false);
    setEditingId(null);
  };
  const mc = prediction?.monte_carlo;
  const nodes = prediction?.node_predictions || [];
  const list = shipments || [];

  return (
    <div className="view-stack">
      <div className="view-head">
        <div>
          <div className="view-title">Shipments</div>
          <div className="view-sub">Each shipment keeps its own independent record</div>
        </div>
        <button className="btn" onClick={openAdd}>
          {showForm && !editingShipment ? "Close form" : "+ Add shipment"}
        </button>
      </div>

      {showForm && !editingShipment && (
        <ShipmentForm
          shipments={list}
          routesMeta={routesMeta}
          onSubmit={(fields) => {
            onAddShipment(fields);
            closeForm();
          }}
          onCancel={closeForm}
        />
      )}

      {editingShipment && (
        <ShipmentForm
          key={editingShipment.id}
          shipments={list}
          routesMeta={routesMeta}
          initial={editingShipment}
          onSubmit={(fields) => {
            onEditShipment(editingShipment.id, fields);
            closeForm();
          }}
          onCancel={closeForm}
        />
      )}

      <section className="panel">
        <h2>Current Shipment</h2>
        <TabState
          loading={loading}
          error={apiError}
          onRetry={onRetry}
          empty={!loading && !apiError && !selectedShipment}
          emptyText="No shipments yet — add your first shipment above."
          loadingText="Loading shipment prediction…"
        />
        {selectedShipment && !loading && !apiError && (
          <div className="shipment-card">
            <div className="shipment-card-main">
              <div className="shipment-idh">
                {selectedShipment.id} · {selectedShipment.origin} → {selectedShipment.destination}
              </div>
              <dl className="ship-grid">
                {INFO_ROWS.map(([key, label, isDate]) => (
                  <div key={key} className="ship-row">
                    <dt>{label}</dt>
                    <dd>
                      {isDate
                        ? formatDate(selectedShipment[key])
                        : selectedShipment[key] || "—"}
                    </dd>
                  </div>
                ))}
              </dl>
              <div className="shipment-detail">
                <span>Expected arrival <b>{mc?.expected_days?.toFixed(1)} d</b></span>
                <span>P90 <b>{mc?.percentiles?.p90?.toFixed(1)} d</b></span>
                <span>Expected delay <b>{delayDaysFromHours(mc?.expected_delay_hours)}</b></span>
                <span>
                  Deadline miss risk{" "}
                  <b>
                    {mc?.deadline_date
                      ? `${Math.round((mc?.p_miss_deadline ?? 0) * 100)}%`
                      : "—"}
                  </b>
                </span>
                <span>
                  Required{" "}
                  <b>{formatDate(mc?.deadline_date || selectedShipment.requiredDate)}</b>
                </span>
                <span>{mc?.n_simulations?.toLocaleString()} simulations</span>
              </div>
            </div>
            <div className="shipment-card-route">
              <CheckpointCards nodes={nodes} />
            </div>
          </div>
        )}
      </section>

      <section className="panel">
        <h2>All Shipments ({list.length})</h2>
        {list.length === 0 ? (
          <p className="muted">Registry is empty.</p>
        ) : (
          <table className="data-table recent-table">
            <thead>
              <tr>
                <th>Shipment ID</th>
                <th>Route</th>
                <th>Type</th>
                <th>Priority</th>
                <th>Status</th>
                <th>Location</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {list.map((s) => (
                <tr key={s.id} className={s.id === selectedId ? "highlight-row" : ""}>
                  <td className="mono">{s.id}</td>
                  <td>{s.origin} → {s.destination}</td>
                  <td>{s.type || "—"}</td>
                  <td>{s.priority}</td>
                  <td>{s.status}</td>
                  <td>{s.location || "—"}</td>
                  <td className="table-actions">
                    {s.id !== selectedId && (
                      <button
                        className="btn ghost mini-btn"
                        onClick={() => onSelectShipment(s.id)}
                      >
                        View
                      </button>
                    )}
                    <button
                      className="btn ghost mini-btn"
                      onClick={() => openEdit(s.id)}
                      title={`Edit ${s.id}`}
                    >
                      Edit
                    </button>
                    <button
                      className="btn danger mini-btn"
                      onClick={() => onDeleteShipment(s.id)}
                      title={`Delete ${s.id}`}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="panel">
        <h2>Delay Risk</h2>
        <RecentShipments
          shipments={list}
          selectedId={selectedId}
          onSelect={onSelectShipment}
          prediction={prediction}
          routesMeta={routesMeta}
        />
      </section>

      <section className="panel compact">
        <h2>Early Warning Alerts</h2>
        <AlertsPanel nodes={prediction?.node_predictions} />
      </section>
    </div>
  );
}
