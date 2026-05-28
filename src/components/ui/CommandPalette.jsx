import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";

const actions = [
  { id: "dashboard", label: "Go to Dashboard", icon: "📊", action: "goto-dashboard" },
  { id: "chat", label: "Go to Chat", icon: "💬", action: "goto-chat" },
  { id: "logs", label: "Go to Inference Logs", icon: "📋", action: "goto-logs" },
  { id: "errors", label: "Go to Errors", icon: "❌", action: "goto-errors" },
  { id: "projects", label: "Go to Projects", icon: "📁", action: "goto-projects" },
  { id: "alerts", label: "Go to Alerts", icon: "🔔", action: "goto-alerts" },
  { id: "billing", label: "Go to Billing", icon: "💰", action: "goto-billing" },
  { id: "audit", label: "Go to Audit Logs", icon: "📝", action: "goto-audit" },
  { id: "toggle-theme", label: "Toggle Dark/Light Theme", icon: "🌓", action: "toggle-theme" },
  { id: "shortcuts", label: "Show Keyboard Shortcuts", icon: "⌨️", action: "keyboard-shortcuts" },
];

const routeMap = {
  "goto-dashboard": "/",
  "goto-chat": "/chat",
  "goto-logs": "/logs",
  "goto-errors": "/errors",
  "goto-projects": "/projects",
  "goto-alerts": "/alerts",
  "goto-billing": "/billing",
  "goto-audit": "/audit",
};

export default function CommandPalette({ isOpen, onClose, onToggleTheme }) {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef(null);
  const navigate = useNavigate();

  const filtered = query.trim()
    ? actions.filter((a) =>
        a.label.toLowerCase().includes(query.toLowerCase()) ||
        a.id.toLowerCase().includes(query.toLowerCase())
      )
    : actions;

  useEffect(() => {
    if (isOpen) {
      setQuery("");
      setSelectedIndex(0);
    }
  }, [isOpen]);

  // focus input after render
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  const execute = useCallback((actionId) => {
    onClose();
    if (routeMap[actionId]) {
      navigate(routeMap[actionId]);
    } else if (actionId === "toggle-theme") {
      onToggleTheme?.();
    } else if (actionId === "keyboard-shortcuts") {
      // Could show a shortcuts modal
    }
  }, [navigate, onClose, onToggleTheme]);

  const handleKeyDown = (e) => {
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, filtered.length - 1));
        break;
      case "ArrowUp":
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
        break;
      case "Enter":
        e.preventDefault();
        if (filtered[selectedIndex]) execute(filtered[selectedIndex].action);
        break;
      case "Escape":
        e.preventDefault();
        onClose();
        break;
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]" onClick={onClose}>
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" />
      <div
        className="relative w-full max-w-lg rounded-2xl border border-white/10 bg-[#1e293b] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setSelectedIndex(0); }}
          onKeyDown={handleKeyDown}
          placeholder="Search actions..."
          className="w-full rounded-t-2xl border-0 border-b border-white/10 bg-transparent px-5 py-4 text-sm text-white placeholder-gray-500 outline-none"
        />
        <div className="max-h-72 overflow-y-auto py-2">
          {filtered.length === 0 ? (
            <div className="px-5 py-4 text-sm text-gray-500">No results found</div>
          ) : (
            filtered.map((item, i) => (
              <button
                key={item.id}
                onClick={() => execute(item.action)}
                className={`flex w-full items-center gap-3 px-5 py-2.5 text-left text-sm transition-colors ${
                  i === selectedIndex
                    ? "bg-blue-600/20 text-blue-300"
                    : "text-gray-300 hover:bg-white/5"
                }`}
              >
                <span className="text-base">{item.icon}</span>
                <span>{item.label}</span>
                <span className="ml-auto text-xs text-gray-600">{item.id}</span>
              </button>
            ))
          )}
        </div>
        <div className="border-t border-white/10 px-5 py-2 text-[11px] text-gray-600">
          <span>↑↓ Navigate</span>
          <span className="ml-4">↵ Select</span>
          <span className="ml-4">Esc Close</span>
        </div>
      </div>
    </div>
  );
}
