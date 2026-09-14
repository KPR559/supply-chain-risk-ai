// Shared report-export helpers (Reports page + Dashboard export action).
import { fmtDays, fmtDelayDays, fmtPct, missVerdict, overallReason, riskBand } from "./models.js";
import { buildRecommendations } from "./recommendations.js";
import { formatDate } from "./utils/helpers.js";

function download(filename, text, mime) {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function csvCell(v) {
  if (v == null) return "";
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function stampName(prefix) {
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  return `${prefix}-${stamp}`;
}

/** Plain-text shipment brief for pasting into tickets, chats and emails. */
export async function copyShipmentSummary({ prediction, selectedShipment }) {
  const mc = prediction?.monte_carlo;
  const nodes = prediction?.node_predictions || [];
  const maxProb = nodes.length ? Math.max(...nodes.map((n) => n.delay_probability ?? 0)) : 0;
  const id = prediction?.shipment_id || selectedShipment?.id || "Unknown shipment";
  const lines = [
    `LOGIX shipment brief — ${id}`,
    `Route: ${selectedShipment?.origin || "?"} → ${selectedShipment?.destination || "?"}`,
    `Status: ${selectedShipment?.status || "Unknown"} · Mode: ${selectedShipment?.mode || "—"}`,
    `Predicted ETA: ${mc?.expected_eta_date || "—"} · Delay probability: ${Math.round(maxProb * 100)}%`,
    `Deadline miss: ${mc?.deadline_date != null ? `${Math.round((mc?.p_miss_deadline ?? 0) * 100)}%` : "no deadline"} · Simulations: ${mc?.n_simulations?.toLocaleString() ?? "—"}`,
  ];
  await navigator.clipboard.writeText(lines.join("\n"));
}

export function exportJsonSnapshot({ prediction, explanation, critical, selectedShipment }) {
  const snapshot = {
    exported_at: new Date().toISOString(),
    shipment: selectedShipment || null,
    prediction: prediction || null,
    explanation: explanation || null,
    critical: critical || null,
  };
  const id = prediction?.shipment_id || selectedShipment?.id || "report";
  download(`${stampName(`logix-${id}`)}.json`, JSON.stringify(snapshot, null, 2), "application/json");
}

export function exportNodesCsv({ prediction, selectedShipment }) {
  const nodes = prediction?.node_predictions || [];
  const header = ["node_id", "label", "delay_probability", "expected_delay_hours", "p50_h", "p80_h", "p90_h", "congestion", "weather", "conflict", "regime"];
  const lines = [header.join(",")];
  for (const n of nodes) {
    lines.push([
      n.node_id, n.label, n.delay_probability, n.expected_delay_hours,
      n.p50, n.p80, n.p90, n.congestion, n.weather, n.conflict, n.regime,
    ].map(csvCell).join(","));
  }
  const id = prediction?.shipment_id || selectedShipment?.id || "report";
  download(`${stampName(`logix-${id}-checkpoints`)}.csv`, lines.join("\n"), "text/csv");
}

/**
 * Formatted PDF intelligence report for the current shipment.
 * jspdf is dynamically imported so it stays out of the main bundle.
 */
export async function exportPdfReport({ prediction, explanation, critical, selectedShipment }) {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const M = 15;
  const RW = 210 - 2 * M;
  let y = M;

  const need = (h) => {
    if (y + h > 280) {
      doc.addPage();
      y = M;
    }
  };
  const heading = (t) => {
    need(13);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.setTextColor(15, 40, 80);
    doc.text(t, M, y);
    y += 7;
  };
  const row = (label, value) => {
    need(7);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(110, 110, 110);
    doc.text(label, M, y);
    doc.setTextColor(20, 20, 20);
    doc.text(String(value ?? "—"), M + 58, y);
    y += 6;
  };
  const para = (t) => {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(20, 20, 20);
    const lines = doc.splitTextToSize(t, RW);
    need(lines.length * 5 + 2);
    doc.text(lines, M, y);
    y += lines.length * 5 + 3;
  };

  const mc = prediction?.monte_carlo;
  const nodes = prediction?.node_predictions || [];
  const band = riskBand(nodes, mc);
  const id = prediction?.shipment_id || selectedShipment?.id || "report";

  doc.setFont("helvetica", "bold");
  doc.setFontSize(17);
  doc.setTextColor(15, 40, 80);
  doc.text("LOGIX Shipment Intelligence Report", M, y);
  y += 7;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(110, 110, 110);
  doc.text(`Generated ${new Date().toLocaleString("en-GB")}`, M, y);
  y += 10;

  heading("Shipment");
  row("Shipment ID", id);
  row("Route", selectedShipment?.origin && selectedShipment?.destination
    ? `${selectedShipment.origin} → ${selectedShipment.destination}`
    : prediction?.route_name || "—");
  row("Current location", selectedShipment?.location || "Not tracked");
  row("Transport mode", selectedShipment?.mode || "—");
  row("Status", selectedShipment?.status || "—");
  row("Expected arrival", mc?.expected_eta_date ? formatDate(mc.expected_eta_date) : "—");
  y += 3;

  heading("Key Metrics");
  const maxProb = nodes.length ? Math.max(...nodes.map((n) => n.delay_probability ?? 0)) : 0;
  const disrupted = nodes.filter((n) => n.regime === 1).length;
  row("Overall risk", `${band.label} (${band.score}/100)`);
  row("Delay probability", `${fmtPct(maxProb)} · worst checkpoint`);
  row("Expected delay", fmtDelayDays(mc?.expected_delay_hours));
  row("P50 / P90 transit", `${fmtDays(mc?.percentiles?.p50)} / ${fmtDays(mc?.percentiles?.p90)}`);
  row("Deadline miss", mc?.deadline_date != null ? fmtPct(mc?.p_miss_deadline) : "No deadline set");
  row("Critical checkpoints", String(critical?.critical_nodes?.length ?? 0));
  row("Active disruptions", String(disrupted));
  row("Simulations", mc?.n_simulations?.toLocaleString() ?? "—");
  y += 3;

  heading("Risk Assessment");
  const miss = mc?.p_miss_deadline ?? 0;
  para(`Verdict: ${missVerdict(miss, mc?.deadline_date != null).label}. ${overallReason({ prediction, explanation, critical })}`);
  y += 1;

  heading("Recommended Actions");
  const recs = buildRecommendations({ prediction, explanation, critical });
  recs.forEach((r, i) => {
    para(`${i + 1}. [${r.priority.toUpperCase()}] ${r.title} — ${r.why} Expected impact: ${r.impact}`);
  });
  y += 1;

  heading("Critical Checkpoints");
  const critList = critical?.critical_nodes || [];
  if (!critList.length) {
    para("No checkpoint dominates the delay profile for this shipment.");
  }
  const probById = Object.fromEntries(nodes.map((n) => [n.node_id, n.delay_probability ?? 0]));
  critList.forEach((c, i) => {
    para(`${i + 1}. ${c.label || c.node_id} — ${fmtPct(c.delay_share)} of total delay · delay probability ${fmtPct(probById[c.node_id])}`);
  });
  y += 2;

  doc.setFont("helvetica", "italic");
  doc.setFontSize(9);
  doc.setTextColor(130, 130, 130);
  need(6);
  doc.text("Generated by LOGIX AI Supply Chain Suite · recommendations are rule-based derivations of live engine data.", M, y);

  doc.save(`${stampName(`logix-${id}-report`)}.pdf`);
}
