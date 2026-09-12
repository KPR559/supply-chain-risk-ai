"""Graph Attention Network (GAT) for upstream -> downstream influence.

Implemented with plain PyTorch (no torch_geometric dependency). The network
learns *which* upstream checkpoints most affect downstream delay on the route
graph; its learned residual is used to adjust node delay predictions, so the
GNN output genuinely affects the final ETA / risk prediction.

The GAT is integral but *optional*: if torch is unavailable the system runs
with the tabular propagation path and clearly falls back.
"""
from __future__ import annotations

from typing import Dict, List, Optional

import numpy as np
import pandas as pd

try:
    import torch
    import torch.nn as nn
    import torch.nn.functional as F
    TORCH_AVAILABLE = True
except Exception:  # pragma: no cover
    TORCH_AVAILABLE = False

from backend.core.config import get_settings
from backend.core.graph import topology
from backend.core.logging_util import get_logger

log = get_logger(__name__)


if TORCH_AVAILABLE:

    class GATLayer(nn.Module):
        """Single graph-attention layer over an adjacency (message passing).

        Accepts inputs of shape [B, N, F] (batch of graphs, one per timestep).
        """

        def __init__(self, in_dim: int, out_dim: int, n_heads: int = 4,
                     negative_slope: float = 0.2, dropout: float = 0.1):
            super().__init__()
            self.n_heads = n_heads
            self.dropout = nn.Dropout(dropout)
            self.leaky = nn.LeakyReLU(negative_slope)
            self.W = nn.Linear(in_dim, out_dim * n_heads, bias=False)
            self.a_src = nn.Parameter(torch.empty(n_heads, out_dim))
            self.a_dst = nn.Parameter(torch.empty(n_heads, out_dim))
            nn.init.xavier_uniform_(self.a_src)
            nn.init.xavier_uniform_(self.a_dst)

        def forward(self, x: torch.Tensor, adj: torch.Tensor) -> torch.Tensor:
            # x: [B, N, in], adj: [N, N] {0,1}
            B, N, _ = x.shape
            h = self.W(x).view(B, N, self.n_heads, -1)         # [B, N, H, F]
            src_score = (h * self.a_src).sum(-1)               # [B, N, H]
            dst_score = (h * self.a_dst).sum(-1)
            score = src_score.unsqueeze(2) + dst_score.unsqueeze(1)   # [B, N, N, H]
            score = self.leaky(score)
            mask = (adj.unsqueeze(0).unsqueeze(-1) + torch.eye(N, device=x.device).unsqueeze(0).unsqueeze(-1) > 0)
            score = score.masked_fill(~mask, float("-inf"))
            att = F.softmax(score, dim=2)                       # [B, N, N, H]
            att = self.dropout(att)
            out = torch.einsum("bnmh,bmhf->bnhf", att, h)       # [B, N, H, F]
            return out.mean(dim=2)                              # [B, N, F]

    class DelayGAT(nn.Module):
        """GAT that regresses node delay residual from features + adjacency."""

        def __init__(self, in_dim: int, hidden: int = 48, heads: int = 4):
            super().__init__()
            self.layer1 = GATLayer(in_dim, hidden, heads)
            self.layer2 = GATLayer(hidden, hidden, heads)
            self.out = nn.Linear(hidden, 1)

        def forward(self, x: torch.Tensor, adj: torch.Tensor) -> torch.Tensor:
            h = F.relu(self.layer1(x, adj))
            h = F.relu(self.layer2(h, adj))
            return self.out(h).squeeze(-1)


def route_adjacency(route_id: str) -> np.ndarray:
    """Adjacency matrix for a route's node order (1 if path connects i->j or j->i
    or i==j). Attention can thereby flow upstream/downstream along the route."""
    route = topology.route_by_id(route_id).node_ids
    n = len(route)
    adj = np.eye(n)
    edges = set()
    for a, b in zip(route, route[1:]):
        edges.add((a, b))
    idx = {nid: i for i, nid in enumerate(route)}
    for (a, b) in edges:
        i, j = idx[a], idx[b]
        adj[i, j] = 1.0
        adj[j, i] = 1.0
    return adj


class GATIntegrator:
    """Trains and applies a GAT residual adjustment to node delay predictions.

    The GAT is trained on historical gold data (node features -> delay residual)
    for a route. At inference the learned attention is applied to the current
    feature vectors; the output adjusts the delay magnitude prediction.
    """

    def __init__(self, route_id: str, in_dim: int, seed: Optional[int] = None):
        if not TORCH_AVAILABLE:
            raise RuntimeError("torch not available - GAT disabled")
        torch.manual_seed(seed if seed is not None else get_settings().mc_seed)
        self.route_id = route_id
        self.in_dim = in_dim
        self.model = DelayGAT(in_dim)
        self.adj = torch.tensor(route_adjacency(route_id), dtype=torch.float)
        self.trained = False

    # ------------------------------------------------------------------
    def fit(self, node_order: List[str], X: np.ndarray, y: np.ndarray,
            epochs: int = 50, lr: float = 1e-3, verbose: bool = False) -> Dict:
        """Train on per-observation node feature matrices.

        X: [T, N, F], y: [T, N] delay residuals (targets).
        """
        if not TORCH_AVAILABLE:
            return {"error": "no torch"}
        Xt = torch.tensor(np.asarray(X, dtype=np.float32))
        yt = torch.tensor(np.asarray(y, dtype=np.float32))
        opt = torch.optim.Adam(self.model.parameters(), lr=lr)
        lossf = nn.MSELoss()
        history = []
        self.model.train()
        n_batches = max(int(np.ceil(Xt.shape[0] / 64)), 1)
        for ep in range(epochs):
            perm = torch.randperm(Xt.shape[0])
            total_loss = 0.0
            for bi in range(n_batches):
                sel = perm[bi * 64:(bi + 1) * 64]
                xb = Xt[sel]
                yb = yt[sel]
                pred = self.model(xb, self.adj)
                loss = lossf(pred, yb)
                opt.zero_grad()
                loss.backward()
                opt.step()
                total_loss += float(loss.item())
            history.append(total_loss / n_batches)
            if verbose and ep % 10 == 0:
                log.info(f"GAT epoch {ep}: loss={history[-1]:.4f}")
        self.trained = True
        return {"loss_history": history, "final_loss": history[-1]}

    # ------------------------------------------------------------------
    def predict_residual(self, X: np.ndarray) -> np.ndarray:
        """Apply the learned graph attention to feature matrices."""
        if not self.trained or not TORCH_AVAILABLE:
            return np.zeros(X.shape[0])
        self.model.eval()
        Xt = torch.tensor(np.asarray(X, dtype=np.float32))
        with torch.no_grad():
            return self.model(Xt, self.adj).numpy()


def build_gat_features(feature_row: Dict[str, float],
                       feature_names: List[str]) -> np.ndarray:
    """Project a feature row into the fixed GAT input vector (missing -> 0)."""
    out = np.zeros(len(feature_names), dtype=np.float32)
    for i, c in enumerate(feature_names):
        out[i] = feature_row.get(c, 0.0) or 0.0
    return out


def train_gat_for_route(ml: pd.DataFrame, feature_names: List[str],
                        route_id: str = "suez", epochs: int = 40) -> Optional["GATIntegrator"]:
    """Train the GAT integrator on gold data restricted to the route's nodes.

    Returns None if torch is unavailable (graceful fallback).
    """
    if not TORCH_AVAILABLE:
        log.info("torch unavailable - GAT disabled, using tabular propagation")
        return None
    route = topology.route_by_id(route_id)
    subset = ml[ml["node_id"].isin(route.node_ids)].copy()
    subset = subset.sort_values("timestamp").reset_index(drop=True)
    # Build per-day feature matrices in route node order
    node_order = route.node_ids
    X_parts = []
    y_parts = []
    for date, g in subset.groupby(pd.to_datetime(subset["timestamp"]).dt.normalize()):
        if len(g) < len(node_order):
            continue
        got = {r["node_id"]: i for i, r in g.iterrows()}
        mat = np.zeros((len(node_order), len(feature_names)), dtype=np.float32)
        y = np.zeros(len(node_order), dtype=np.float32)
        for j, nid in enumerate(node_order):
            row = g[g["node_id"] == nid]
            if row.empty:
                continue
            r = row.iloc[0]
            for k, c in enumerate(feature_names):
                v = r.get(c, np.nan)
                mat[j, k] = 0.0 if pd.isna(v) else float(v)
            y[j] = float(r["delay_hours"])
        if np.isfinite(mat).all():
            X_parts.append(mat)
            y_parts.append(y)
    if len(X_parts) < 20:
        log.warning("Too few GAT training days; disabling")
        return None
    X_arr = np.stack(X_parts)
    y_arr = np.stack(y_parts)
    integrator = GATIntegrator(route_id, len(feature_names), seed=get_settings().mc_seed)
    integrator.fit(node_order, X_arr, y_arr, epochs=epochs)
    integrator.node_order = node_order  # type: ignore[attr-defined]
    return integrator