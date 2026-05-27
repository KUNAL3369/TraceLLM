import { useState, useEffect } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine,
  BarChart, Bar, PieChart, Pie, Cell,
} from "recharts";
import MetricCard from "../components/ui/MetricCard";
import { useProjectStore } from "../stores/projectStore";
import { supabase } from "../lib/supabase";

const COLORS = ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899"];

function StatusDot({ status }) {
  const colors = { healthy: "bg-green-400", degraded: "bg-amber-400", down: "bg-red-400", unknown: "bg-gray-500" };
  return <span className={`inline-block h-2 w-2 rounded-full ${colors[status] || colors.unknown}`} />;
}

function formatCost(cents) {
  if (!cents) return "$0.00";
  if (cents < 0.01) return "<$0.01";
  return `$${cents.toFixed(4)}`;
}

export default function Dashboard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [alerts, setAlerts] = useState([]);
  const [providerHealth, setProviderHealth] = useState([]);
  const selectedProjectId = useProjectStore((s) => s.selectedProjectId);

  useEffect(() => {
    async function fetchMetrics() {
      setLoading(true);
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const params = new URLSearchParams();
        if (selectedProjectId) params.set("project_id", selectedProjectId);

        const res = await fetch(`/api/metrics?${params}`, {
          headers: session ? { Authorization: `Bearer ${session.access_token}` } : {},
        });
        if (res.ok) {
          const json = await res.json();
          setData(json);
        }
      } catch (err) {
        console.error("Metrics fetch error:", err);
      } finally {
        setLoading(false);
      }
    }

    fetchMetrics();

    fetch("/api/provider-health").then((r) => r.ok && r.json()).then(setProviderHealth).catch(() => {});
    if (selectedProjectId) {
      fetch(`/api/alerts/events?project_id=${selectedProjectId}`)
        .then((r) => r.ok && r.json())
        .then((events) => setAlerts(events?.filter((e) => e.status === "triggered") || []))
        .catch(() => {});
    }

    const interval = setInterval(fetchMetrics, 30000);
    return () => clearInterval(interval);
  }, [selectedProjectId]);

  if (loading && !data) {
    return (
      <div className="space-y-6">
        <div className="h-6 w-48 animate-pulse rounded bg-[#1e293b]" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-24 animate-pulse rounded-2xl bg-[#1e293b]" />
          ))}
        </div>
      </div>
    );
  }

  const summary = data?.summary || {};
  const trends = data?.trends || [];
  const providers = data?.providers || [];
  const models = data?.models || [];
  const costData = data?.cost || {};

  return (
    <div className="space-y-6">
      {alerts.length > 0 && (
        <div className="rounded-2xl border border-red-500/30 bg-red-900/20 p-4">
          <div className="flex items-center gap-2">
            <span className="text-lg">🚨</span>
            <span className="text-sm font-medium text-red-400">{alerts.length} active alert{alerts.length > 1 ? "s" : ""}</span>
          </div>
          <div className="mt-1 space-y-1">
            {alerts.slice(0, 3).map((a) => (
              <div key={a.id} className="text-xs text-red-300">
                {a.alerts?.name || "Alert"} — Value: {a.triggered_value} — {new Date(a.triggered_at).toLocaleTimeString()}
              </div>
            ))}
          </div>
        </div>
      )}

      {providerHealth.length > 0 && (
        <div className="flex gap-3">
          {providerHealth.map((p) => (
            <div key={p.provider} className="flex items-center gap-2 rounded-xl border border-white/10 bg-[#1e293b] px-3 py-2">
              <StatusDot status={p.status} />
              <span className="text-xs font-medium text-white capitalize">{p.provider}</span>
              <span className="text-xs text-gray-400">{p.avg_latency_ms}ms</span>
              <span className={`text-xs ${p.success_rate > 95 ? "text-green-400" : p.success_rate > 80 ? "text-amber-400" : "text-red-400"}`}>
                {p.success_rate}%
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Dashboard</h1>
          <p className="text-sm text-gray-400">Real-time LLM inference metrics</p>
        </div>
        {selectedProjectId && (
          <span className="rounded-full bg-blue-900/30 px-3 py-1 text-xs text-blue-400">
            Project: {useProjectStore.getState().projects.find((p) => p.id === selectedProjectId)?.name || "Selected"}
          </span>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard title="Total Requests" value={(summary.total_requests || 0).toLocaleString()} unit="" icon="📨" />
        <MetricCard title="Avg Latency" value={summary.avg_latency || 0} unit="ms" icon="⚡" />
        <MetricCard title="P95 Latency" value={summary.p95_latency || 0} unit="ms" icon="🎯" />
        <MetricCard title="Tokens" value={((summary.total_tokens || 0) / 1000).toFixed(1)} unit="K" icon="🔤" />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard title="Successful" value={summary.successful_requests || 0} unit="" icon="✅" />
        <MetricCard title="Failed" value={summary.failed_requests || 0} unit="" icon="❌" />
        <MetricCard title="Active Sessions" value={summary.active_sessions || 0} unit="" icon="👥" />
        <MetricCard title="Req/min" value={summary.requests_per_minute || 0} unit="" icon="📈" />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard title="Est. Cost" value={formatCost(costData?.estimated_total)} unit="" icon="💰" />
        <MetricCard title="Success Rate" value={summary.total_requests ? ((summary.successful_requests / summary.total_requests) * 100).toFixed(1) : "0"} unit="%" icon="📊" />
        <MetricCard title="Total Prompt" value={(summary.total_prompt_tokens || 0).toLocaleString()} unit="" icon="📝" />
        <MetricCard title="Total Completion" value={(summary.total_completion_tokens || 0).toLocaleString()} unit="" icon="📄" />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-2xl border border-white/10 bg-[#1e293b] p-5">
          <h3 className="mb-4 text-sm font-medium text-gray-300">Request Throughput</h3>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={trends}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis dataKey="time" tick={{ fill: "#94a3b8", fontSize: 11 }} />
              <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} />
              <Tooltip contentStyle={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 8, color: "#fff" }} />
              <Line type="monotone" dataKey="requests" stroke="#3b82f6" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="rounded-2xl border border-white/10 bg-[#1e293b] p-5">
          <h3 className="mb-4 text-sm font-medium text-gray-300">Latency Trend (ms)</h3>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={trends}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis dataKey="time" tick={{ fill: "#94a3b8", fontSize: 11 }} />
              <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} />
              <Tooltip contentStyle={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 8, color: "#fff" }} />
              <ReferenceLine y={500} stroke="#f59e0b" strokeDasharray="6 6" label={{ value: "Threshold", fill: "#f59e0b", fontSize: 11 }} />
              <Line type="monotone" dataKey="latency" stroke="#10b981" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="rounded-2xl border border-white/10 bg-[#1e293b] p-5">
          <h3 className="mb-4 text-sm font-medium text-gray-300">Token Usage Trend</h3>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={trends}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis dataKey="time" tick={{ fill: "#94a3b8", fontSize: 11 }} />
              <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} />
              <Tooltip contentStyle={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 8, color: "#fff" }} />
              <Bar dataKey="tokens" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="rounded-2xl border border-white/10 bg-[#1e293b] p-5">
          <h3 className="mb-4 text-sm font-medium text-gray-300">Provider Distribution</h3>
          <ResponsiveContainer width="100%" height={220}>
            <PieChart>
              <Pie data={providers} cx="50%" cy="50%" innerRadius={50} outerRadius={90} paddingAngle={4} dataKey="value">
                {providers.map((_, i) => (
                  <Cell key={i} fill={COLORS[i % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip contentStyle={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 8, color: "#fff" }} />
            </PieChart>
          </ResponsiveContainer>
          <div className="mt-2 flex flex-wrap justify-center gap-3">
            {providers.map((p, i) => (
              <span key={p.name} className="flex items-center gap-1 text-xs text-gray-400">
                <span className="h-2 w-2 rounded-full" style={{ background: COLORS[i % COLORS.length] }} />
                {p.name} {p.value}%
              </span>
            ))}
          </div>
        </div>
      </div>

      {models.length > 0 && (
        <div className="rounded-2xl border border-white/10 bg-[#1e293b] p-5">
          <h3 className="mb-4 text-sm font-medium text-gray-300">Model Usage</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-white/10">
                  <th className="px-4 py-3 font-medium text-gray-400">Model</th>
                  <th className="px-4 py-3 font-medium text-gray-400">Requests</th>
                </tr>
              </thead>
              <tbody>
                {models.map((m, i) => (
                  <tr key={m.name} className="border-b border-white/5 transition-colors hover:bg-[#1e293b]/50">
                    <td className="px-4 py-3 font-mono text-xs text-white">{m.name}</td>
                    <td className="px-4 py-3 text-gray-300">{m.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
