import { useApi } from "../hooks/useApi";
import { useProjectStore } from "../stores/projectStore";

export default function AuditLogs() {
  const selectedProjectId = useProjectStore((s) => s.selectedProjectId);
  const params = selectedProjectId ? `?project_id=${selectedProjectId}` : "";
  const { data: logs, loading } = useApi(`/api/audit${params}`);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-white">Audit Logs</h1>
        <p className="text-sm text-gray-400">Track critical actions across your project</p>
      </div>

      {!selectedProjectId && (
        <div className="flex h-32 items-center justify-center rounded-2xl border border-white/10 bg-[#1e293b] text-sm text-gray-500">
          Select a project to view audit logs
        </div>
      )}

      {loading && <div className="h-48 animate-pulse rounded-2xl bg-[#1e293b]" />}

      {!loading && logs && logs.length === 0 && selectedProjectId && (
        <div className="flex h-32 items-center justify-center rounded-2xl border border-white/10 bg-[#1e293b] text-sm text-gray-500">
          No audit logs yet. Actions like creating alerts, API keys, and changing settings are tracked here.
        </div>
      )}

      {logs && logs.length > 0 && (
        <div className="overflow-x-auto rounded-2xl border border-white/10">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-white/10 bg-[#1e293b]">
                <th className="px-4 py-3 font-medium text-gray-400">Time</th>
                <th className="px-4 py-3 font-medium text-gray-400">Action</th>
                <th className="px-4 py-3 font-medium text-gray-400">Details</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => (
                <tr key={log.id} className="border-b border-white/5 transition-colors hover:bg-[#1e293b]/50">
                  <td className="whitespace-nowrap px-4 py-3 text-gray-300">
                    {new Date(log.created_at).toLocaleString()}
                  </td>
                  <td className="px-4 py-3">
                    <span className="rounded-full bg-[#0f172a] px-2 py-0.5 font-mono text-xs text-blue-400">
                      {log.action}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-400">
                    {log.metadata ? JSON.stringify(log.metadata).slice(0, 100) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
