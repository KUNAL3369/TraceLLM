import { useApi } from "../hooks/useApi";
import { supabase } from "../lib/supabase";
import { useState } from "react";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3001";

const PLANS = {
  free: { name: "Free", requests: "1,000", color: "bg-gray-900/30 text-gray-400", features: ["1,000 requests/mo", "Basic metrics", "Email alerts"] },
  pro: { name: "Pro", requests: "10,000", color: "bg-blue-900/30 text-blue-400", features: ["10,000 requests/mo", "Advanced analytics", "Slack + Email alerts", "PII redaction"] },
  growth: { name: "Growth", requests: "100,000", color: "bg-purple-900/30 text-purple-400", features: ["100,000 requests/mo", "All features", "Priority support", "Custom webhooks"] },
};

export default function Billing() {
  const { data, loading, refetch } = useApi("/api/billing");
  const [upgrading, setUpgrading] = useState(null);

  const currentPlan = data?.subscription?.plan || "free";
  const usage = data?.usage || 0;
  const limit = data?.subscription?.monthly_limit || 1000;
  const pct = Math.min(100, Math.round((usage / limit) * 100));

  const upgrade = async (plan) => {
    setUpgrading(plan);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      await fetch(`${API_URL}/api/billing/upgrade`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ plan }),
      });
      refetch();
    } catch (err) {
      console.error("Upgrade error:", err);
    } finally {
      setUpgrading(null);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Billing</h1>
        <p className="text-sm text-gray-400">Manage your subscription and usage</p>
      </div>

      {loading && <div className="h-48 animate-pulse rounded-2xl bg-[#1e293b]" />}

      {!loading && data && (
        <>
          <div className="rounded-2xl border border-white/10 bg-[#1e293b] p-5">
            <h3 className="text-sm font-medium text-gray-300">Current Usage</h3>
            <div className="mt-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-400">{usage.toLocaleString()} / {limit.toLocaleString()} requests</span>
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${pct > 80 ? "bg-red-900/30 text-red-400" : "bg-blue-900/30 text-blue-400"}`}>
                  {pct}%
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-[#0f172a]">
                <div className={`h-full rounded-full transition-all ${pct > 80 ? "bg-red-500" : "bg-blue-500"}`} style={{ width: `${pct}%` }} />
              </div>
              <div className="flex items-center justify-between text-xs text-gray-500">
                <span>Period: {data.subscription?.billing_period_start ? new Date(data.subscription.billing_period_start).toLocaleDateString() : "Start"} — {data.subscription?.billing_period_end ? new Date(data.subscription.billing_period_end).toLocaleDateString() : "End"}</span>
                <span>{data.projects} project(s)</span>
              </div>
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            {Object.entries(PLANS).map(([id, plan]) => {
              const isCurrent = currentPlan === id;
              return (
                <div key={id} className={`rounded-2xl border p-5 ${isCurrent ? "border-blue-500 bg-blue-600/10" : "border-white/10 bg-[#1e293b]"}`}>
                  <div className="flex items-center justify-between">
                    <h3 className="text-lg font-bold text-white">{plan.name}</h3>
                    {isCurrent && <span className="rounded-full bg-blue-900/30 px-2 py-0.5 text-xs text-blue-400">Current</span>}
                  </div>
                  <p className="mt-1 text-2xl font-bold text-white">{plan.requests}<span className="text-sm font-normal text-gray-400"> /mo</span></p>
                  <ul className="mt-4 space-y-2">
                    {plan.features.map((f, i) => (
                      <li key={i} className="flex items-center gap-2 text-xs text-gray-400">
                        <span className="text-green-400">✓</span> {f}
                      </li>
                    ))}
                  </ul>
                  {!isCurrent && (
                    <button
                      onClick={() => upgrade(id)}
                      disabled={upgrading === id}
                      className="mt-4 w-full rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                    >
                      {upgrading === id ? "Upgrading..." : `Upgrade to ${plan.name}`}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
