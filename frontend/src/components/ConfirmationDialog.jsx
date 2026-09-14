import React from "react";
import Modal from "./Modal.jsx";

export default function ConfirmationDialog({
  open,
  title,
  message,
  note,
  confirmLabel,
  onConfirm,
  onCancel,
  busy,
}) {
  return (
    <Modal open={open} onClose={onCancel} title={title}>
      <p>{message}</p>
      <p className="muted">This action cannot be undone.</p>
      {note && <p className="muted demo-note">{note}</p>}
      <div className="modal-actions">
        <button className="btn ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button className="btn danger" onClick={onConfirm} disabled={busy} autoFocus>
          {busy ? "Deleting…" : confirmLabel || "Delete"}
        </button>
      </div>
    </Modal>
  );
}
