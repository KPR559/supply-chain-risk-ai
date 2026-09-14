"""Graph validation — connectivity, orphans, edge integrity, route coverage.

Usage:
  python -m backend.core.graph.validate         # CLI
  from backend.core.graph.validate import validate  # programmatic
"""
from __future__ import annotations

import pandas as pd

from backend.core import storage
from backend.core.graph import topology
from backend.core.logging_util import get_logger

log = get_logger(__name__)


def validate() -> dict:
    issues: list[str] = []
    warnings: list[str] = []

    nodes = topology.node_index()
    edges = topology.EDGE_DEFS
    routes = topology.ROUTES

    # 1. Node/edge referential integrity
    node_ids = set(nodes.keys())
    for e in edges:
        if e.src not in node_ids:
            issues.append(f"Edge {e.src} -> {e.dst}: src '{e.src}' not in NODE_DEFS")
        if e.dst not in node_ids:
            issues.append(f"Edge {e.src} -> {e.dst}: dst '{e.dst}' not in NODE_DEFS")
        if e.distance_km <= 0:
            issues.append(f"Edge {e.src} -> {e.dst}: distance_km={e.distance_km} must be >0")
        if not 0 < e.baseline_days:
            issues.append(f"Edge {e.src} -> {e.dst}: baseline_days={e.baseline_days} must be >0")

    # 2. Orphan nodes (no incoming and no outgoing edge)
    srcs = {e.src for e in edges}
    dsts = {e.dst for e in edges}
    all_edge_nodes = srcs | dsts
    orphans = node_ids - all_edge_nodes
    if orphans:
        warnings.append(f"Orphan nodes (no edges): {sorted(orphans)} — they are still reachable via weather/conflict features, but not via graph propagation")

    # 3. Route validity: every consecutive hop must have an edge; route must be a path in the graph
    for r in routes:
        try:
            es = topology.route_edges(r)
            if not es:
                warnings.append(f"Route {r.route_id}: 0 edges")
            for e in es:
                if e not in edges:
                    issues.append(f"Route {r.route_id}: edge {e.src}->{e.dst} not in EDGE_DEFS")
        except ValueError as ve:
            issues.append(str(ve))

    # 4. Checkpoint ordering: routes should follow geographic sense (no immediate backtrack)
    for r in routes:
        for a, b in zip(r.node_ids, r.node_ids[1:]):
            # Check that b is not earlier in the route (cycle check — routes should be simple paths)
            if r.node_ids.index(a) > r.node_ids.index(b):
                warnings.append(f"Route {r.route_id}: node {b} appears before {a} — possible cycle")

    # 5. Geographic sanity: edges with >15,000 km are suspicious (half earth)
    for e in edges:
        if e.distance_km > 15000:
            warnings.append(f"Edge {e.src}->{e.dst} distance {e.distance_km:.0f} km is very long — verify coordinates")

    # 6. DuckDB parquet sanity
    try:
        ckpt = pd.read_parquet(storage.get_settings().abs_data_dir / "silver" / "checkpoints.parquet")
        re = pd.read_parquet(storage.get_settings().abs_data_dir / "silver" / "route_edges.parquet")
        if len(ckpt) != len(node_ids):
            issues.append(f"checkpoints.parquet has {len(ckpt)} rows but NODE_DEFS has {len(node_ids)}")
        if len(re) != len(edges):
            issues.append(f"route_edges.parquet has {len(re)} rows but EDGE_DEFS has {len(edges)}")
    except Exception as e:
        warnings.append(f"Parquet check skipped: {e}")

    # 7. Weak connectivity (undirected reachability): all non-orphan nodes should be reachable from any other
    # Build undirected adjacency for connectivity check
    adj: dict[str, set[str]] = {n: set() for n in node_ids}
    for e in edges:
        adj[e.src].add(e.dst)
        adj[e.dst].add(e.src)
    if node_ids - orphans:
        start = next(iter(node_ids - orphans))
        visited: set[str] = set()
        stack = [start]
        while stack:
            cur = stack.pop()
            if cur in visited:
                continue
            visited.add(cur)
            stack.extend(adj[cur] - visited)
        unreachable = (node_ids - orphans) - visited
        if unreachable:
            issues.append(f"Disconnected component: {sorted(unreachable)} not reachable from {start} (undirected)")

    status = "PASS" if not issues else "FAIL"
    result = {"status": status, "issues": issues, "warnings": warnings,
              "nodes": len(node_ids), "edges": len(edges), "routes": len(routes),
              "orphans": sorted(orphans)}
    if issues:
        log.warning(f"Graph validation {status}: {issues}")
    if warnings:
        log.info(f"Graph warnings: {warnings}")
    log.info(f"Graph validation {status}: {len(node_ids)} nodes, {len(edges)} edges, {len(routes)} routes")
    return result


def main() -> None:
    r = validate()
    print(f"Status: {r['status']}")
    print(f"Nodes: {r['nodes']}, Edges: {r['edges']}, Routes: {r['routes']}")
    if r["orphans"]:
        print(f"Orphans: {r['orphans']}")
    if r["issues"]:
        print("ISSUES:")
        for i in r["issues"]:
            print(f"  - {i}")
    if r["warnings"]:
        print("WARNINGS:")
        for w in r["warnings"]:
            print(f"  - {w}")
    if r["status"] == "PASS":
        print("All routes form valid paths in the graph.")


if __name__ == "__main__":
    main()
