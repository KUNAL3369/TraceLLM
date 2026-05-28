import { useState, useEffect, useRef, useCallback } from "react";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3001";

export function useRealtimeMetrics(projectId) {
  const [metrics, setMetrics] = useState(null);
  const [providerHealth, setProviderHealth] = useState([]);
  const [alertEvents, setAlertEvents] = useState([]);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState(null);
  const sourceRef = useRef(null);
  const reconnectRef = useRef(null);

  const connect = useCallback(() => {
    if (sourceRef.current) sourceRef.current.close();

    const params = new URLSearchParams();
    if (projectId) params.set("project_id", projectId);

    const url = `${API_URL}/api/realtime/metrics/stream?${params}`;
    const source = new EventSource(url);
    sourceRef.current = source;

    source.onopen = () => {
      setConnected(true);
      setError(null);
    };

    source.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        switch (payload.type) {
          case "metrics":
            setMetrics(payload.data);
            break;
          case "provider_health":
            setProviderHealth(payload.data);
            break;
          case "alert":
            setAlertEvents((prev) => [payload.data, ...prev].slice(0, 50));
            break;
        }
      } catch {
        // ignore parse errors
      }
    };

    source.onerror = () => {
      setConnected(false);
      setError("Connection lost. Reconnecting...");
      source.close();
      reconnectRef.current = setTimeout(connect, 3000);
    };
  }, [projectId]);

  useEffect(() => {
    connect();
    return () => {
      if (sourceRef.current) sourceRef.current.close();
      if (reconnectRef.current) clearTimeout(reconnectRef.current);
    };
  }, [connect]);

  return { metrics, providerHealth, alertEvents, connected, error };
}
