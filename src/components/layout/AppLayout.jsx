import { useEffect, useState, useCallback } from "react";
import { useAuthStore } from "../../stores/authStore";
import { useProjectStore } from "../../stores/projectStore";
import Sidebar from "./Sidebar";
import CommandPalette from "../ui/CommandPalette";
import OnboardingFlow from "../ui/OnboardingFlow";
import { useKeyboardShortcuts } from "../../hooks/useKeyboardShortcuts";
import { useTheme } from "../../stores/themeStore";
import { Toaster } from "react-hot-toast";

export default function AppLayout({ children }) {
  const user = useAuthStore((s) => s.user);
  const loadProjects = useProjectStore((s) => s.loadProjects);
  const [commandOpen, setCommandOpen] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const { toggleTheme } = useTheme();

  useEffect(() => {
    if (user) {
      loadProjects();
    }
  }, [user, loadProjects]);

  useEffect(() => {
    if (user) {
      const done = localStorage.getItem("tracellm-onboarding-complete");
      if (!done) setShowOnboarding(true);
    }
  }, [user]);

  const navigate = useCallback((path) => {
    window.location.href = path;
  }, []);

  const handlerMap = useCallback(() => ({
    "command-palette": () => setCommandOpen(true),
    "keyboard-shortcuts": () => setCommandOpen(true),
    "goto-dashboard": () => navigate("/"),
    "goto-chat": () => navigate("/chat"),
    "goto-logs": () => navigate("/logs"),
    "goto-errors": () => navigate("/errors"),
    "goto-projects": () => navigate("/projects"),
    "goto-alerts": () => navigate("/alerts"),
    "goto-billing": () => navigate("/billing"),
    "close": () => setCommandOpen(false),
    "toggle-theme": toggleTheme,
  }), [navigate, toggleTheme]);

  const handlers = handlerMap();
  useKeyboardShortcuts(handlers);

  return (
    <div className="min-h-screen bg-[#0f172a] text-white transition-colors">
      <Toaster
        position="top-right"
        toastOptions={{
          style: {
            background: "#1e293b",
            color: "#fff",
            border: "1px solid rgba(255,255,255,0.1)",
            borderRadius: "12px",
          },
        }}
      />
      <CommandPalette
        isOpen={commandOpen}
        onClose={() => setCommandOpen(false)}
        onToggleTheme={toggleTheme}
      />
      <OnboardingFlow onComplete={() => setShowOnboarding(false)} />
      {showOnboarding && <OnboardingFlow onComplete={() => setShowOnboarding(false)} />}
      <div className="flex min-h-screen">
        <Sidebar />
        <main className="ml-60 flex-1 overflow-auto p-6">{children}</main>
      </div>
    </div>
  );
}
