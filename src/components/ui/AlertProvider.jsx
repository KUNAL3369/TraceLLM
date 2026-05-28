import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useCallback,
} from "react";
import toast from "react-hot-toast";

const AlertContext = createContext(null);

export function AlertProvider({ children }) {
  const sourceRef = useRef(null);

  const showAlertToast = useCallback((alert) => {
    toast(
      (t) => (
        <div className="flex items-center gap-3">
          <span className="text-lg">🚨</span>
          <div className="flex-1">
            <p className="text-sm font-medium text-white">
              {alert.title || "Alert Triggered"}
            </p>
            <p className="text-xs text-gray-400">{alert.message || ""}</p>
          </div>
          <button
            onClick={() => toast.dismiss(t.id)}
            className="text-xs text-gray-500 hover:text-white"
          >
            ✕
          </button>
        </div>
      ),
      {
        duration: 8000,
        style: {
          background: "#1e293b",
          border: "1px solid rgba(239,68,68,0.3)",
        },
      },
    );
  }, []);

  useEffect(() => {
    const token = localStorage.getItem("tracellm-auth-token");
    if (!token) return;

    const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3001";
    const source = new EventSource(`${API_URL}/api/realtime/metrics/stream`);
    sourceRef.current = source;

    source.addEventListener("alert", (event) => {
      try {
        const payload = JSON.parse(event.data);
        showAlertToast(payload);
      } catch {
        console.warn("[SSE] Failed to parse alert event");
      }
    });

    return () => {
      source.close();
    };
  }, [showAlertToast]);

  return (
    <AlertContext.Provider value={{ showAlertToast }}>
      {children}
    </AlertContext.Provider>
  );
}

export function useAlerts() {
  return useContext(AlertContext);
}
