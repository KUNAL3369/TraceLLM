import { useEffect, useCallback } from "react";

const defaultBindings = {
  "ctrl+k": { action: "command-palette", description: "Open command palette" },
  "ctrl+/": { action: "keyboard-shortcuts", description: "Show keyboard shortcuts" },
  "g d": { action: "goto-dashboard", description: "Go to dashboard" },
  "g c": { action: "goto-chat", description: "Go to chat" },
  "g l": { action: "goto-logs", description: "Go to logs" },
  "g p": { action: "goto-projects", description: "Go to projects" },
  "g a": { action: "goto-alerts", description: "Go to alerts" },
  "g b": { action: "goto-billing", description: "Go to billing" },
  "escape": { action: "close", description: "Close modal / cancel" },
  "?": { action: "keyboard-shortcuts", description: "Show keyboard shortcuts" },
};

let buffer = "";
let bufferTimeout = null;

export function useKeyboardShortcuts(handlers = {}) {
  const handleKeyDown = useCallback((e) => {
    const key = e.key;
    const ctrl = e.ctrlKey || e.metaKey;

    // Single key combos
    for (const [binding, config] of Object.entries(defaultBindings)) {
      const [mod, k] = binding.split("+");
      if (mod === "ctrl" && ctrl && key.toLowerCase() === k) {
        e.preventDefault();
        handlers[config.action]?.();
        return;
      }
      if (binding === key && !ctrl) {
        e.preventDefault();
        handlers[config.action]?.();
        return;
      }
    }

    // Sequence bindings (g + letter)
    if (key === "g" && !ctrl) {
      buffer = "g";
      clearTimeout(bufferTimeout);
      bufferTimeout = setTimeout(() => { buffer = ""; }, 500);
      return;
    }
    if (buffer === "g") {
      const seq = `g ${key}`;
      clearTimeout(bufferTimeout);
      buffer = "";
      const config = defaultBindings[seq];
      if (config) {
        e.preventDefault();
        handlers[config.action]?.();
      }
    }
  }, [handlers]);

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);
}

export function getKeyboardShortcuts() {
  return Object.entries(defaultBindings).map(([key, value]) => ({
    key,
    ...value,
  }));
}

export { defaultBindings };
