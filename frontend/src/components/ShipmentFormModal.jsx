import React, { useState } from "react";
import Modal from "./Modal.jsx";
import { blankShipment, PRIORITIES, ROUTE_IDS, STATUSES } from "../shipments.js";
import { routeDisplayName } from "../utils/helpers.js";

const FIELD_DEFS = [
  ["id", "Shipment ID", "text", "SHP004"],
  ["origin", "Origin", "text", "Frankfurt, Germany"],
  ["destination", "Destination", "text", "Mumbai, India"],
  ["type", "Shipment Type", "text", "Automotive Parts"],
  ["mode", "Transport Mode", "text", "Sea + Road"],
  ["departureDate", "Departure Date", "date", ""],
  ["requiredDate", "Required Delivery Date", "date", ""],
  ["location", "Current Location", "text", "Hamburg Port"],
];

export default function ShipmentFormModal({ open, initial, shipments, routesMeta, onSubmit, onClose }) {
  const isEdit = Boolean(initial);
  const [form, setForm] = useState(() => (initial ? { ...initial } : blankShipment()));
  const [errors, setErrors] = useState({});

  // The parent passes key={initial?.id || "new"} so the form resets per record.
  if (!open) return null;

  const set = (key, value) => {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((e) => ({ ...e, [key]: null }));
  };

  const routeName = (rid) =>
    routesMeta.find((r) => r.route_id === rid)?.name || routeDisplayName(rid);

  const submit = (e) => {
    e.preventDefault();
    const errs = {};
    const id = (form.id || "").trim();
    if (!id) errs.id = "Shipment ID is required.";
    else if (!isEdit && (shipments || []).some((s) => s.id.toLowerCase() === id.toLowerCase()))
      errs.id = "This Shipment ID already exists.";
    if (!(form.origin || "").trim()) errs.origin = "Origin is required.";
    if (!(form.destination || "").trim()) errs.destination = "Destination is required.";
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;
    onSubmit({
      ...form,
      id,
      origin: (form.origin || "").trim(),
      destination: (form.destination || "").trim(),
      type: (form.type || "").trim(),
      mode: (form.mode || "").trim(),
      location: (form.location || "").trim(),
    });
  };

  return (
    <Modal open={open} onClose={onClose} title={isEdit ? `Edit Shipment ${initial.id}` : "Add Shipment"} wide>
      <form onSubmit={submit}>
        <div className="form-grid">
          {FIELD_DEFS.map(([key, label, type, placeholder]) => (
            <label key={key} className="form-field">
              <span>{label}</span>
              <input
                type={type}
                value={form[key] || ""}
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
        <p className="muted demo-note">Demo registry — shipments are stored locally in this browser, not on the backend.</p>
        <div className="modal-actions">
          <button className="btn ghost" type="button" onClick={onClose}>Cancel</button>
          <button className="btn" type="submit">{isEdit ? "Save changes" : "Add shipment"}</button>
        </div>
      </form>
    </Modal>
  );
}
