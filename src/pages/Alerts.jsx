import { useState } from "react";
import { useApi } from "../hooks/useApi";
import { useProjectStore } from "../stores/projectStore";
import { supabase } from "../lib/supabase";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3001";

const ALERT_TYPES = [
  { id: "latency_spike", label: "Latency Spike", desc: "Average latency exceeds threshold" },
  { id: "error_rate_spike", label: "Error Rate Spike", desc: "Error rate exceeds threshold (%)" },
  { id: "token_burn_spike", label: "Token Burn Spike", desc: "Token usage exceeds threshold" },
  { id: "provider_outage", label: "Provider Outage", desc: "Provider failures exceed threshold" },
  { id: "throughput_drop", label: "Throughput Drop", desc: "Requests/min drops below threshold" },
];

export default function Alerts() {
  const selectedProjectId = useProjectStore((s) => s.selectedProjectId);
  const params = selectedProjectId ? `?project_id=${selectedProjectId}` : "";
  const { data: alerts, loading, refetch } = useApi(`/api/alerts${params}`);
  const { data: events } = useApi(selectedProjectId ? `/api/alerts/events${params}` : null);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: "", alert_type: "latency_spike", threshold_value: "", time_window_minutes: 5, notification_channel: "email" });

  const createAlert = async () => {
    if (!form.name || !form.threshold_value || !selectedProjectId) return;
    try {
      const { data: { session } } = await supabase.auth.getSession();
      await fetch(`${API_URL}/api/alerts`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ ...form, threshold_value: Number(form.threshold_value), project_id: selectedProjectId }),
      });
      setShowCreate(false);
      setForm({ name: "", alert_type: "latency_spike", threshold_value: "", time_window_minutes: 5, notification_channel: "email" });
      refetch();
    } catch (err) {
      console.error("Create alert error:", err);
    }
  };

  const deleteAlert = async (id) => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      await fetch(`${API_URL}/api/alerts/${id}`, { method: "DELETE", headers: { Authorization: `Bearer ${session.access_token}` } });
      refetch();
    } catch (err) {
      console.error("Delete alert error:", err);
    }
  };

  const toggleAlert = async (alert) => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      await fetch(`${API_URL}/api/alerts/${alert.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ is_active: !alert.is_active }),
      });
      refetch();
    } catch (err) {
      console.error("Toggle alert error:", err);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Alerts</h1>
          <p className="text-sm text-gray-400">Configure observability alerting rules</p>
        </div>
        <button onClick={() => setShowCreate(!showCreate)} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">
          {showCreate ? "Cancel" : "+ New Alert"}
        </button>
      </div>

      {!selectedProjectId && (
        <div className="flex h-32 items-center justify-center rounded-2xl border border-white/10 bg-[#1e293b] text-sm text-gray-500">
          Select a project to manage alerts
        </div>
      )}

      {showCreate && selectedProjectId && (
        <div className="rounded-2xl border border-white/10 bg-[#1e293b] p-5 space-y-4">
          <h3 className="text-sm font-medium text-white">Create Alert Rule</h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs text-gray-400">Alert Name</label>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="w-full rounded-lg border border-white/10 bg-[#0f172a] px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none" placeholder="High Latency Alert" />
            </div>
            <div>
              <label className="mb-1 block text-xs text-gray-400">Type</label>
              <select value={form.alert_type} onChange={(e) => setForm({ ...form, alert_type: e.target.value })}
                className="w-full rounded-lg border border-white/10 bg-[#0f172a] px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none">
                {ALERT_TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs text-gray-400">Threshold</label>
              <input type="number" value={form.threshold_value} onChange={(e) => setForm({ ...form, threshold_value: e.target.value })}
                className="w-full rounded-lg border border-white/10 bg-[#0f172a] px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none" placeholder="3000" />
            </div>
            <div>
              <label className="mb-1 block text-xs text-gray-400">Time Window (min)</label>
              <input type="number" value={form.time_window_minutes} onChange={(e) => setForm({ ...form, time_window_minutes: Number(e.target.value) })}
                className="w-full rounded-lg border border-white/10 bg-[#0f172a] px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none" />
            </div>
            <div>
              <label className="mb-1 block text-xs text-gray-400">Notify Via</label>
              <select value={form.notification_channel} onChange={(e) => setForm({ ...form, notification_channel: e.target.value })}
                className="w-full rounded-lg border border-white/10 bg-[#0f172a] px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none">
                <option value="email">Email</option>
                <option value="slack">Slack</option>
                <option value="webhook">Webhook</option>
                <option value="all">All Channels</option>
              </select>
            </div>
          </div>
          <button onClick={createAlert} disabled={!form.name || !form.threshold_value}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
            Create Alert
          </button>
        </div>
      )}

      {loading && <div className="h-32 animate-pulse rounded-2xl bg-[#1e293b]" />}

      {!loading && alerts && alerts.length === 0 && selectedProjectId && (
        <div className="flex h-32 items-center justify-center rounded-2xl border border-white/10 bg-[#1e293b] text-sm text-gray-500">
          No alerts configured. Create one above.
        </div>
      )}

      {alerts && alerts.length > 0 && (
        <div className="space-y-3">
          {alerts.map((alert) => (
            <div key={alert.id} className={`rounded-2xl border p-4 transition-colors ${alert.is_active ? "border-white/10 bg-[#1e293b]" : "border-white/5 bg-[#1e293b]/50 opacity-60"}`}>
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <span className={`h-2 w-2 rounded-full ${alert.is_active ? "bg-green-400" : "bg-gray-600"}`} />
                    <span className="font-medium text-white">{alert.name}</span>
                    <span className="rounded-full bg-[#0f172a] px-2 py-0.5 text-xs text-gray-400">
                      {ALERT_TYPES.find((t) => t.id === alert.alert_type)?.label || alert.alert_type}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-gray-500">
                    Threshold: {alert.comparison_operator} {alert.threshold_value} · Window: {alert.time_window_minutes}m · Channel: {alert.notification_channel}
                  </p>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => toggleAlert(alert)}
                    className="rounded-lg bg-[#0f172a] px-3 py-1.5 text-xs text-gray-400 hover:text-white">
                    {alert.is_active ? "Pause" : "Activate"}
                  </button>
                  <button onClick={() => deleteAlert(alert.id)}
                    className="rounded-lg bg-[#0f172a] px-3 py-1.5 text-xs text-red-400 hover:text-red-300">
                    Delete
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {events && events.length > 0 && (
        <div className="rounded-2xl border border-white/10 bg-[#1e293b] p-5">
          <h3 className="mb-4 text-sm font-medium text-gray-300">Recent Alert Events</h3>
          <div className="space-y-2">
            {events.slice(0, 10).map((evt) => (
              <div key={evt.id} className="flex items-center justify-between rounded-lg bg-[#0f172a] px-3 py-2">
                <div>
                  <span className="text-sm text-white">{evt.alerts?.name || "Alert"}</span>
                  <span className="ml-2 text-xs text-gray-500">Value: {evt.triggered_value}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${evt.status === "triggered" ? "bg-red-900/30 text-red-400" : "bg-green-900/30 text-green-400"}`}>
                    {evt.status}
                  </span>
                  <span className="text-xs text-gray-500">{new Date(evt.triggered_at).toLocaleString()}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
