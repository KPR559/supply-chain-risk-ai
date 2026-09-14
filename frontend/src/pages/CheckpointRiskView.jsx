import React, { useMemo, useState } from "react";
import TabState from "../components/TabState.jsx";
import Modal from "../components/Modal.jsx";
import CheckpointRiskCard from "../components/checkpoint/CheckpointRiskCard.jsx";
import CheckpointDetailTable from "../components/checkpoint/CheckpointDetailTable.jsx";
import CriticalCheckpointList from "../components/checkpoint/CriticalCheckpointList.jsx";
import CheckpointDetailPanel from "../components/checkpoint/CheckpointDetailPanel.jsx";
import { getCheckpointKind, getCheckpointStatus } from "../models.js";

const SORTS = [
  { id: "risk-desc", label: "Highest risk" },
  { id: "risk-asc", label: "Lowest risk" },
  { id: "delay-desc", label: "Highest expected delay" },
  { id: "delay-asc", label: "Lowest expected delay" },
  { id: "alpha", label: "Alphabetical A–Z" },
  { id: "order", label: "Route order" },
];

export default function CheckpointRiskView({ data }) {
  const { prediction, critical, loading, apiError, onRetry } = data;
  const nodes = prediction?.node_predictions || [];
  const ready = nodes.length > 0;
  const criticalItems = critical?.critical_nodes || [];
  const criticalCount = criticalItems.length;

  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("risk-desc");
  const [selectedId, setSelectedId] = useState(null);
  const [detailId, setDetailId] = useState(null);

  const rankByProb = useMemo(
    () => [...nodes].sort((a, b) => (b.delay_probability ?? 0) - (a.delay_probability ?? 0)),
    [nodes]
  );
  const topId = rankByProb[0]?.node_id || null;

  // Default selection is the highest-risk checkpoint; once the user picks one,
  // it is preserved as long as the checkpoint still exists in the dataset.
  const effectiveSelected = selectedId && nodes.some((n) => n.node_id === selectedId)
    ? selectedId
    : topId;

  const selectNode = (id) => setSelectedId(id);
  const openDetails = (id) => {
    setSelectedId(id);
    setDetailId(id);
  };

  const visibleNodes = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? nodes.filter((n) => {
        const kind = getCheckpointKind(n);
        const status = getCheckpointStatus(n).label.toLowerCase();
        const regime = n.regime === 1 ? "disrupted" : n.regime === 0 ? "normal" : "unknown";
        return (
          (n.label || n.node_id || "").toLowerCase().includes(q) ||
          kind.toLowerCase().includes(q) ||
          regime.includes(q) ||
          status.includes(q)
        );
      })
      : [...nodes];
    const by = {
      "risk-desc": (a, b) => (b.delay_probability ?? 0) - (a.delay_probability ?? 0),
      "risk-asc": (a, b) => (a.delay_probability ?? 0) - (b.delay_probability ?? 0),
      "delay-desc": (a, b) => (b.expected_delay_hours ?? 0) - (a.expected_delay_hours ?? 0),
      "delay-asc": (a, b) => (a.expected_delay_hours ?? 0) - (b.expected_delay_hours ?? 0),
      alpha: (a, b) => String(a.label || a.node_id).localeCompare(String(b.label || b.node_id)),
      order: () => 0,
    }[sort];
    return filtered.sort(by);
  }, [nodes, query, sort]);

  const detailNode = nodes.find((n) => n.node_id === detailId) || null;

  return (
    <div className="view-stack">
      <div className="view-head">
        <div>
          <div className="view-title">Checkpoint Risk</div>
          <div className="view-sub">Per-checkpoint delay probability along the corridor</div>
        </div>
      </div>

      <TabState
        loading={loading}
        error={apiError}
        onRetry={onRetry}
        empty={!ready}
        emptyText="No checkpoint data yet — select a shipment to run the engine."
        loadingText="Scoring checkpoints…"
      />

      {ready && (
        <>
          <div className="filter-bar">
            <input
              type="search"
              placeholder="Search checkpoints…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Search checkpoints by name, kind or regime"
            />
            <select value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort checkpoints">
              {SORTS.map((s) => (
                <option key={s.id} value={s.id}>Sort: {s.label}</option>
              ))}
            </select>
            <span className="muted">{visibleNodes.length} of {nodes.length}</span>
          </div>

          {visibleNodes.length === 0 && (
            <div className="empty-state">
              <div className="empty-title">No checkpoints match your search.</div>
              <div className="muted">Try a different name, kind or regime.</div>
            </div>
          )}

          <section className="panel compact">
            <h2>Risk at Each Checkpoint</h2>
            <div className="rk-cards">
              {visibleNodes.map((n) => (
                <CheckpointRiskCard
                  key={n.node_id}
                  node={n}
                  selected={n.node_id === effectiveSelected}
                  onSelect={openDetails}
                />
              ))}
            </div>
          </section>

          <section className="panel">
            <h2>Checkpoint Detail</h2>
            <CheckpointDetailTable
              nodes={visibleNodes}
              selectedId={effectiveSelected}
              onSelect={selectNode}
              onDetail={openDetails}
              topId={topId}
            />
          </section>

          {criticalCount > 0 && (
            <section className="panel">
              <h2>Critical Checkpoints</h2>
              <p className="muted">
                Ranked by share of total shipment delay · {criticalCount}
                {criticalCount === 1 ? " checkpoint" : " checkpoints"}
              </p>
              <CriticalCheckpointList
                data={critical}
                nodes={nodes}
                selectedId={effectiveSelected}
                onSelect={selectNode}
              />
            </section>
          )}
        </>
      )}

      <Modal
        open={detailNode != null}
        onClose={() => setDetailId(null)}
        title={detailNode?.label || detailNode?.node_id || "Checkpoint Details"}
      >
        <CheckpointDetailPanel node={detailNode} />
      </Modal>
    </div>
  );
}