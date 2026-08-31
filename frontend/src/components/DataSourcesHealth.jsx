import React from "react";

const SOURCES = [
  { name: "AIS Vessel Tracking", key: "ais" },
  { name: "Port Congestion Index", key: "port" },
  { name: "ERA5 Weather Data", key: "weather" },
  { name: "Customs Clearance API", key: "customs" },
  { name: "Conflict & Geopolitical Feed", key: "conflict" },
  { name: "Historical Shipment DB", key: "history" },
];

export default function DataSourcesHealth({ health, dq }) {
  const models = health?.models || [];
  const hasData = dq?.status === "ok";

  return (
    <div className="sources-list">
      {SOURCES.map((s) => {
        const live = models.length > 0 || hasData;
        return (
          <div className="source-row" key={s.key}>
            <span className={`source-dot ${live ? "live" : "offline"}`} />
            <span className="source-name">{s.name}</span>
            <span className={`source-status ${live ? "live" : ""}`}>
              {live ? "Live" : "Offline"}
            </span>
          </div>
        );
      })}
    </div>
  );
}
