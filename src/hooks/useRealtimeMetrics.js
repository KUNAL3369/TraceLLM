import { useState, useEffect, useRef } from "react";
import { supabase } from "../lib/supabase";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3001";

export function useRealtimeMetrics(projectId) {
  const [metrics, setMetrics] = useState(null);
  const [providerHealth, setProviderHealth] = useState([]);
  const [alertEvents, setAlertEvents] = useState([]);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState(null);
  const sourceRef = useRef(null);
  const reconnectRef = useRef(null);
  const projectIdRef = useRef(projectId);

  useEffect(() => {
    projectIdRef.current = projectId;

    const connect = async () => {
      if (sourceRef.current) sourceRef.current.close();

      const params = new URLSearchParams();
      if (projectIdRef.current) params.set("project_id", projectIdRef.current);

      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (session?.access_token) params.set("token", session.access_token);

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
          console.warn("[SSE] Failed to parse metrics event");
        }
      };

      source.onerror = () => {
        setConnected(false);
        setError("Connection lost. Reconnecting...");
        source.close();
        reconnectRef.current = setTimeout(connect, 3000);
      };
    };

    connect();
    return () => {
      if (sourceRef.current) sourceRef.current.close();
      if (reconnectRef.current) clearTimeout(reconnectRef.current);
    };
  }, [projectId]);

  return { metrics, providerHealth, alertEvents, connected, error };
}
