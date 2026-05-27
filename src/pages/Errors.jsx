import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from "recharts";
import { useApi } from "../hooks/useApi";
import { useProjectStore } from "../stores/projectStore";

const COLORS = ["#ef4444", "#f59e0b", "#3b82f6", "#8b5cf6", "#ec4899"];
const ERROR_COLORS = { timeout: "#ef4444", rate_limit: "#f59e0b", invalid: "#3b82f6" };

export default function Errors() {
  const selectedProjectId = useProjectStore((s) => s.selectedProjectId);
  const params = new URLSearchParams();
  if (selectedProjectId) params.set("project_id", selectedProjectId);
  const { data, loading } = useApi(`/api/metrics?${params}`);

  const errorBreakdown = data?.error_breakdown || [];
  const errorsByProvider = data?.errors_by_provider || [];

  if (loading) {
    return <div className="space-y-6">
      <div className="h-6 w-48 animate-pulse rounded bg-[#1e293b]" />
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="h-80 animate-pulse rounded-2xl bg-[#1e293b]" />
        <div className="h-80 animate-pulse rounded-2xl bg-[#1e293b]" />
      </div>
    </div>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Error Analytics</h1>
        <p className="text-sm text-gray-400">Failure breakdown by provider and type</p>
      </div>

      {errorBreakdown.length === 0 && errorsByProvider.length === 0 && (
        <div className="flex h-32 items-center justify-center rounded-2xl border border-white/10 bg-[#1e293b] text-sm text-gray-500">
          No errors recorded yet.
        </div>
      )}

      {errorBreakdown.length > 0 && (
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="rounded-2xl border border-white/10 bg-[#1e293b] p-5">
            <h3 className="mb-4 text-sm font-medium text-gray-300">Errors by Provider</h3>
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={errorsByProvider}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis dataKey="provider" tick={{ fill: "#94a3b8", fontSize: 11 }} />
                <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} />
                <Tooltip contentStyle={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 8, color: "#fff" }} />
                <Bar dataKey="timeout" stackId="a" fill="#ef4444" />
                <Bar dataKey="rate_limit" stackId="a" fill="#f59e0b" />
                <Bar dataKey="invalid" stackId="a" fill="#3b82f6" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
            <div className="mt-3 flex justify-center gap-4">
              <span className="flex items-center gap-1 text-xs text-gray-400"><span className="h-2 w-2 rounded-full bg-red-500" /> Timeout</span>
              <span className="flex items-center gap-1 text-xs text-gray-400"><span className="h-2 w-2 rounded-full bg-amber-500" /> Rate Limit</span>
              <span className="flex items-center gap-1 text-xs text-gray-400"><span className="h-2 w-2 rounded-full bg-blue-500" /> Invalid</span>
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-[#1e293b] p-5">
            <h3 className="mb-4 text-sm font-medium text-gray-300">Error Distribution</h3>
            <ResponsiveContainer width="100%" height={280}>
              <PieChart>
                <Pie data={errorBreakdown} cx="50%" cy="50%" outerRadius={90} paddingAngle={4} dataKey="value" label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}>
                  {errorBreakdown.map((_, i) => (
                    <Cell key={i} fill={COLORS[i % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip contentStyle={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 8, color: "#fff" }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {errorsByProvider.length > 0 && (
        <div className="rounded-2xl border border-white/10 bg-[#1e293b] p-5">
          <h3 className="mb-4 text-sm font-medium text-gray-300">Error Details</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-white/10">
                  <th className="px-4 py-3 font-medium text-gray-400">Provider</th>
                  <th className="px-4 py-3 font-medium text-gray-400">Timeout</th>
                  <th className="px-4 py-3 font-medium text-gray-400">Rate Limit</th>
                  <th className="px-4 py-3 font-medium text-gray-400">Invalid</th>
                  <th className="px-4 py-3 font-medium text-gray-400">Total</th>
                </tr>
              </thead>
              <tbody>
                {errorsByProvider.map((row) => (
                  <tr key={row.provider} className="border-b border-white/5 transition-colors hover:bg-[#1e293b]/50">
                    <td className="px-4 py-3 font-medium text-white">{row.provider}</td>
                    <td className="px-4 py-3 text-red-400">{row.timeout}</td>
                    <td className="px-4 py-3 text-amber-400">{row.rate_limit}</td>
                    <td className="px-4 py-3 text-blue-400">{row.invalid}</td>
                    <td className="px-4 py-3 text-gray-300">{row.total}</td>
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
