import { NavLink } from "react-router-dom";
import { useAuthStore } from "../../stores/authStore";
import { useProjectStore } from "../../stores/projectStore";
import { useTheme } from "../../stores/themeStore";

const navItems = [
  { to: "/", label: "Dashboard", icon: "📊" },
  { to: "/chat", label: "Chat Demo", icon: "💬" },
  { to: "/alerts", label: "Alerts", icon: "🔔" },
  { to: "/conversations", label: "Conversations", icon: "📋" },
  { to: "/logs", label: "Inference Logs", icon: "📝" },
  { to: "/errors", label: "Errors", icon: "⚠️" },
  { to: "/projects", label: "Projects", icon: "⚙️" },
  { to: "/billing", label: "Billing", icon: "💰" },
  { to: "/audit", label: "Audit Logs", icon: "📜" },
];

export default function Sidebar() {
  const { user, signOut } = useAuthStore();
  const { projects, selectedProjectId, setSelectedProject, loading } = useProjectStore();
  const { isDark, toggleTheme } = useTheme();

  return (
    <aside className="fixed left-0 top-0 flex h-screen w-60 flex-col border-r border-white/10 bg-[#0f172a]">
      <div className="flex items-center gap-2 border-b border-white/10 px-5 py-4">
        <span className="text-xl">🔭</span>
        <span className="text-lg font-bold text-white">TraceLLM</span>
      </div>

      <div className="border-b border-white/10 px-3 py-2">
        <label className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-gray-500">
          Project
        </label>
        <select
          value={selectedProjectId || ""}
          onChange={(e) => setSelectedProject(e.target.value)}
          disabled={loading || projects.length === 0}
          className="w-full rounded-lg border border-white/10 bg-[#1e293b] px-2 py-1.5 text-xs text-white focus:border-blue-500 focus:outline-none disabled:opacity-50"
        >
          {loading && <option value="">Loading...</option>}
          {!loading && projects.length === 0 && <option value="">No projects</option>}
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>

      <div className="flex items-center justify-between border-b border-white/10 px-4 py-2">
        <span className="text-[10px] font-medium uppercase tracking-wider text-gray-500">
          Navigation
        </span>
        <button
          onClick={() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true }))}
          className="rounded bg-[#1e293b] px-1.5 py-0.5 text-[10px] text-gray-500"
        >
          Ctrl+K
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto p-3">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === "/"}
            className={({ isActive }) =>
              `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                isActive
                  ? "bg-[#1e293b] text-white"
                  : "text-gray-400 hover:bg-[#1e293b] hover:text-white"
              }`
            }
          >
            <span>{item.icon}</span>
            <span>{item.label}</span>
          </NavLink>
        ))}
      </nav>

      <div className="border-t border-white/10 p-4">
        <div className="mb-2 truncate text-xs text-gray-500">{user?.email}</div>
        <div className="flex gap-2">
          <button
            onClick={toggleTheme}
            className="flex-1 rounded-lg bg-[#1e293b] px-3 py-2 text-xs text-gray-400 transition-colors hover:text-white"
            title={`Switch to ${isDark ? "light" : "dark"} mode`}
          >
            {isDark ? "☀️ Light" : "🌙 Dark"}
          </button>
          <button
            onClick={signOut}
            className="rounded-lg bg-[#1e293b] px-3 py-2 text-xs text-gray-400 transition-colors hover:bg-red-900/30 hover:text-red-400"
          >
            Sign Out
          </button>
        </div>
      </div>
    </aside>
  );
}
