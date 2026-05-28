import { useSyncExternalStore, useCallback } from "react";

const THEME_KEY = "tracellm-theme";

function getSystemTheme() {
  if (typeof window === "undefined") return "dark";
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

function getStoredTheme() {
  try {
    return localStorage.getItem(THEME_KEY);
  } catch {
    return null;
  }
}

function getEffectiveTheme() {
  const stored = getStoredTheme();
  if (stored === "dark" || stored === "light") return stored;
  return getSystemTheme();
}

let listeners = [];
let currentTheme = getEffectiveTheme();

function emitChange() {
  for (const listener of listeners) {
    listener();
  }
}

export function useTheme() {
  const theme = useSyncExternalStore(
    useCallback((onStoreChange) => {
      listeners.push(onStoreChange);
      return () => {
        listeners = listeners.filter((l) => l !== onStoreChange);
      };
    }, []),
    () => currentTheme,
    () => "dark"
  );

  const setTheme = useCallback((newTheme) => {
    currentTheme = newTheme;
    try {
      localStorage.setItem(THEME_KEY, newTheme);
    } catch {
      // localStorage unavailable
    }
    document.documentElement.classList.toggle("dark", newTheme === "dark");
    document.documentElement.classList.toggle("light", newTheme === "light");
    emitChange();
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme(currentTheme === "dark" ? "light" : "dark");
  }, [setTheme]);

  return { theme, setTheme, toggleTheme, isDark: theme === "dark" };
}

// Initialize theme on load
const initialTheme = getEffectiveTheme();
document.documentElement.classList.toggle("dark", initialTheme === "dark");
document.documentElement.classList.toggle("light", initialTheme === "light");
