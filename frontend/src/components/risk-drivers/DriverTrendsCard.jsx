import React from "react";
import TrendTable from "./TrendTable.jsx";

export default function DriverTrendsCard({ items, isFallback }) {
  return (
    <section className="panel risk-drivers-trends">
      <div className="panel-head">
        <div>
          <h2>Driver Trends</h2>
          <p className="muted">7-day trend of key risk driver indices</p>
        </div>
      </div>
      <TrendTable items={items} isFallback={isFallback} />
    </section>
  );
}