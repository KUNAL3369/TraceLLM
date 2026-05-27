import { useEffect, useState } from "react";
import MetricCard from "./components/MetricCard";
import "./App.css";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";

export default function App() {
  const [metrics, setMetrics] = useState({
    pageLoadTime: 2400,
    apiLatency: 820,
    errorRate: 2.1,
  });

  const [history, setHistory] = useState([]);

  useEffect(() => {
    const interval = setInterval(() => {
      setMetrics((prev) => {
        const updated = {
          pageLoadTime:
            prev.pageLoadTime + Math.floor(Math.random() * 200 - 100),
          apiLatency:
            prev.apiLatency + Math.floor(Math.random() * 100 - 50),
          errorRate: Number(
            Math.max(0, prev.errorRate + Math.random() * 0.5 - 0.25).toFixed(2)
          ),
        };

        setHistory((h) => [...h.slice(-9), updated]);
        return updated;
      });
    }, 2000);

    return () => clearInterval(interval);
  }, []);
  const PAGE_LOAD_THRESHOLD = 2000;
  const chartData = history.map((item, index) => ({
    time: index + 1,
    value: item.pageLoadTime,
  }));

  return (
    <div className="page">
      <div className="container">
        <div className="header">
          <h1>Frontend Observability Dashboard</h1>
          <p>Live monitoring of frontend performance metrics</p>
        </div>

        <div className="grid">
          <MetricCard
            title="Page Load Time"
            value={metrics.pageLoadTime}
            unit="ms"
            historyKey="pageLoadTime"
            history={history}
          />
          <MetricCard
            title="API Latency"
            value={metrics.apiLatency}
            unit="ms"
            historyKey="apiLatency"
            history={history}
          />
          <MetricCard
            title="Error Rate"
            value={metrics.errorRate}
            unit="%"
            historyKey="errorRate"
            history={history}
          />
        </div>

        {/* 📈 Trend Chart */}
        <div
          className="chart-wrapper"
          style={{
          background: "#dad7cd",
          padding: "20px",
          borderRadius: "12px",
          }}>
        <h2 style={{ marginBottom: "16px", color: "#000" }}>
         Page Load Time Trend
         </h2>

        <ResponsiveContainer width="100%" height={220}>
        <LineChart data={chartData}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="time" />
        <YAxis />
        <Tooltip />
        <ReferenceLine
        y={PAGE_LOAD_THRESHOLD}
        stroke="#d00000"
        strokeDasharray="6 6"
        label={{
        value: "SLA 2000ms",
        position: "right",
        fill: "#d00000",
        fontSize: 12,
        }}
        />

        <Line
        type="monotone"
        dataKey="value"
        stroke="#344e41"
        strokeWidth={2}
        dot={false}
        />
        </LineChart>
        </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
