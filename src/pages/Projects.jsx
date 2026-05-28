import { useState } from "react";
import { useApi } from "../hooks/useApi";
import { supabase } from "../lib/supabase";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3001";

export default function Projects() {
  const { data: projects, loading, refetch } = useApi("/api/projects");
  const [showNew, setShowNew] = useState(false);
  const [newName, setNewName] = useState("");
  const [newEnv, setNewEnv] = useState("development");
  const [creating, setCreating] = useState(false);
  const [newKey, setNewKey] = useState(null);

  const createProject = async () => {
    if (!newName.trim() || creating) return;
    setCreating(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`${API_URL}/api/projects`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ name: newName, environment: newEnv }),
      });
      if (res.ok) {
        const project = await res.json();
        setNewKey(project.api_key);
        refetch();
        setNewName("");
        setShowNew(false);
      }
    } catch (err) {
      console.error("Create project error:", err);
    } finally {
      setCreating(false);
    }
  };

  const createKey = async (projectId) => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`${API_URL}/api/projects/${projectId}/keys`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({}),
      });
      if (res.ok) {
        const key = await res.json();
        setNewKey(key.raw_key);
        refetch();
      }
    } catch (err) {
      console.error("Create key error:", err);
    }
  };

  const revokeKey = async (projectId, keyId) => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      await fetch(`${API_URL}/api/projects/${projectId}/keys/${keyId}/revoke`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      refetch();
    } catch (err) {
      console.error("Revoke key error:", err);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Projects</h1>
          <p className="text-sm text-gray-400">Manage your projects and API keys</p>
        </div>
        <button
          onClick={() => { setShowNew(!showNew); setNewKey(null); }}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          {showNew ? "Cancel" : "+ New Project"}
        </button>
      </div>

      {newKey && (
        <div className="rounded-2xl border border-green-500/30 bg-green-900/20 p-4">
          <h3 className="text-sm font-medium text-green-400">API Key Created</h3>
          <p className="mt-1 text-xs text-gray-400">Copy this key now. You won't be able to see it again.</p>
          <div className="mt-2 flex items-center gap-2">
            <code className="flex-1 rounded-lg bg-[#0f172a] px-3 py-2 font-mono text-xs text-green-300">
              {newKey}
            </code>
            <button
              onClick={() => navigator.clipboard?.writeText(newKey)}
              className="rounded-lg bg-[#0f172a] px-3 py-2 text-xs text-gray-400 hover:text-white"
            >
              Copy
            </button>
          </div>
        </div>
      )}

      {showNew && (
        <div className="rounded-2xl border border-white/10 bg-[#1e293b] p-4">
          <h3 className="mb-3 text-sm font-medium text-white">Create Project</h3>
          <div className="flex gap-2">
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && createProject()}
              placeholder="Project name"
              className="flex-1 rounded-lg border border-white/10 bg-[#0f172a] px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none"
            />
            <select
              value={newEnv}
              onChange={(e) => setNewEnv(e.target.value)}
              className="rounded-lg border border-white/10 bg-[#0f172a] px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none"
            >
              <option value="development">Dev</option>
              <option value="staging">Staging</option>
              <option value="production">Production</option>
            </select>
            <button
              onClick={createProject}
              disabled={!newName.trim() || creating}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {creating ? "Creating..." : "Create"}
            </button>
          </div>
        </div>
      )}

      {loading && (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-28 animate-pulse rounded-2xl bg-[#1e293b]" />
          ))}
        </div>
      )}

      {!loading && projects && (
        <div className="space-y-3">
          {projects.map((project) => (
            <div key={project.id} className="rounded-2xl border border-white/10 bg-[#1e293b] p-5">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-base font-medium text-white">{project.name}</h3>
                  <span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
                    project.environment === "production"
                      ? "bg-green-900/30 text-green-400"
                      : project.environment === "staging"
                      ? "bg-amber-900/30 text-amber-400"
                      : "bg-blue-900/30 text-blue-400"
                  }`}>
                    {project.environment}
                  </span>
                </div>
                <button
                  onClick={() => createKey(project.id)}
                  className="rounded-lg bg-[#0f172a] px-3 py-1.5 text-xs text-gray-400 hover:text-white"
                >
                  + New Key
                </button>
              </div>
              <div className="mt-3 space-y-2">
                {project.api_keys?.map((key) => (
                  <div key={key.id} className="flex items-center gap-2">
                    <code className={`flex-1 rounded-lg px-3 py-2 font-mono text-xs ${
                      key.status === "active" ? "bg-[#0f172a] text-gray-300" : "bg-[#0f172a] text-gray-600 line-through"
                    }`}>
                      {key.status === "active"
                        ? `tracellm_${key.key_preview || key.id.slice(0, 8)}...`
                        : `[REVOKED] ${key.id.slice(0, 8)}...`
                      }
                    </code>
                    {key.status === "active" && (
                      <button
                        onClick={() => revokeKey(project.id, key.id)}
                        className="rounded-lg bg-[#0f172a] px-3 py-2 text-xs text-red-400 hover:text-red-300"
                      >
                        Revoke
                      </button>
                    )}
                  </div>
                ))}
                {(!project.api_keys || project.api_keys.length === 0) && (
                  <div className="text-xs text-gray-600">No API keys. Create one to start ingesting data.</div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
