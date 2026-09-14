import React from "react";
import ProgressBar from "./ProgressBar.jsx";

/**
 * Ranked critical checkpoints by share of total shipment delay.
 *
 * Each item's share (0–100%) comes from the backend when available
 * (critical_nodes.percent / delay_share) and otherwise is derived from the
 * forecast expected delay:
 *   checkpoint_share = checkpoint_expected_delay / total_expected_delay * 100
 * Percentages are clamped to [0, 100] and rounded to one decimal place.
 */
function shareFor(item, byNode, totalHours) {
  if (item.percent != null && Number.isFinite(Number(item.percent))) return Number(item.percent);
  if (item.delay_share != null && Number.isFinite(Number(item.delay_share))) return Number(item.delay_share) * 100;
  const expected = Number(byNode[item.node_id]?.expected_delay_hours);
  if (Number.isFinite(expected) && Number.isFinite(totalHours) && totalHours > 0) {
    return (expected / totalHours) * 100;
  }
  return 0;
}

function toneFor(heat) {
  if (heat >= 0.5) return "hot";
  if (heat >= 0.25) return "warn";
  return "cool";
}

export default function CriticalCheckpointList({ data, nodes, selectedId, onSelect }) {
  const items = data?.critical_nodes || [];
  const byNode = Object.fromEntries((nodes || []).map((n) => [n.node_id, n]));
  const totalHours = (nodes || []).reduce((sum, n) => sum + Number(n.expected_delay_hours || 0), 0);

  const ranked = items
    .map((c, i) => ({
      ...c,
      index: i,
      share: Math.max(0, Math.min(100, shareFor(c, byNode, totalHours))),
    }))
    .filter((c) => Number.isFinite(c.share))
    .sort((a, b) => b.share - a.share);

  const hasContribution = ranked.reduce((s, c) => s + c.share, 0) > 0;

  if (!ranked.length || !hasContribution) {
    return <div className="crit-empty">No delay contribution detected.</div>;
  }

  const maxShare = Math.max(...ranked.map((c) => c.share), 0.0001);

  return (
    <div className="critical-checkpoints-list">
      {ranked.map((c) => {
        const heat = c.share / maxShare;
        const tone = toneFor(heat);
        const selected = c.node_id === selectedId;
        return (
          <div
            key={c.node_id}
            className={`critical-checkpoint-row tone-${tone}${selected ? " is-selected" : ""}${onSelect ? " clickable" : ""}`}
            onClick={onSelect ? () => onSelect(c.node_id) : undefined}
            title={onSelect ? `Select ${c.label || c.node_id}` : `${c.label || c.node_id}: ${c.share.toFixed(1)}% of total delay`}
          >
            <div className="rank-badge" aria-hidden="true">{c.index + 1}</div>
            <div className="checkpoint-info">
              <div className="checkpoint-header">
                <span className="checkpoint-name">{c.label || c.node_id}</span>
                <span className="checkpoint-share">{c.share.toFixed(1)}%</span>
              </div>
              <ProgressBar
                value={(c.share / maxShare) * 100}
                tone={tone}
                title={`${c.share.toFixed(1)}% of total expected delay`}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}