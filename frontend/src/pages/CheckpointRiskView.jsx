import React, { useMemo, useState } from "react";
import CheckpointCards from "../components/CheckpointCards.jsx";
import NodeRiskTable from "../components/NodeRiskTable.jsx";
import CriticalNodes from "../components/CriticalNodes.jsx";
import TabState from "../components/TabState.jsx";

const SORTS = [
  { id: "risk-desc", label: "Highest risk" },
  { id: "risk-asc", label: "Lowest risk" },
  { id: "delay-desc", label: "Highest expected delay" },
  { id: "delay-asc", label: "Lowest expected delay" },
  { id: "order", label: "Checkpoint order" },
];

export default function CheckpointRiskView({ data }) {
  const { prediction, critical, loading, apiError, onRetry } = data;
  const nodes = prediction?.node_predictions || [];
  const ready = nodes.length > 0;
  const criticalCount = critical?.critical_nodes?.length || 0;
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("risk-desc");
  const [selectedId, setSelectedId] = useState(null);

  const shareById = useMemo(
    () => Object.fromEntries((critical?.critical_nodes || []).map((c) => [c.node_id, c.delay_share ?? 0])),
    [critical]
  );

  const rankByProb = useMemo(
    () => [...nodes].sort((a, b) => (b.delay_probability ?? 0) - (a.delay_probability ?? 0)),
    [nodes]
  );
  const topId = rankByProb[0]?.node_id || null;
  // Default selection: highest-risk checkpoint; follows data refreshes.
  const effectiveSelected = selectedId && nodes.some((n) => n.node_id === selectedId)
    ? selectedId
    : topId;

  const visibleNodes = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? nodes.filter((n) => (
        (n.label || n.node_id || "").toLowerCase().includes(q) ||
        (n.kind || "").toLowerCase().includes(q) ||
        (n.regime === 1 ? "disrupted" : n.regime === 0 ? "normal" : "unknown").includes(q)
      ))
      : [...nodes];
    const by = {
      "risk-desc": (a, b) => (b.delay_probability ?? 0) - (a.delay_probability ?? 0),
      "risk-asc": (a, b) => (a.delay_probability ?? 0) - (b.delay_probability ?? 0),
      "delay-desc": (a, b) => (b.expected_delay_hours ?? 0) - (a.expected_delay_hours ?? 0),
      "delay-asc": (a, b) => (a.expected_delay_hours ?? 0) - (b.expected_delay_hours ?? 0),
      order: () => 0,
    }[sort];
    return filtered.sort(by);
  }, [nodes, query, sort]);

  void shareById;

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
              <div className="empty-title">No checkpoints match</div>
              <div className="muted">Try a different search term.</div>
            </div>
          )}

          <section className="panel compact">
            <h2>Risk at Each Checkpoint</h2>
            <CheckpointCards nodes={visibleNodes} selectedId={effectiveSelected} onSelect={setSelectedId} />
          </section>

          <section className="panel">
            <h2>Checkpoint Detail</h2>
            <NodeRiskTable nodes={visibleNodes} selectedId={effectiveSelected} onSelect={setSelectedId} topId={topId} />
          </section>

          {criticalCount > 0 && (
            <section className="panel">
              <h2>Critical Checkpoints</h2>
              <p className="muted">
                Ranked by share of total shipment delay · {criticalCount}
                {criticalCount === 1 ? " checkpoint" : " checkpoints"}
              </p>
              <CriticalNodes data={critical} selectedId={effectiveSelected} onSelect={setSelectedId} />
            </section>
          )}
        </>
      )}
    </div>
  );
}
