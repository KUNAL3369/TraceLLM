import { useState, useEffect } from "react";
import { supabase } from "../lib/supabase";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3001";

function buildUrl(endpoint) {
  if (!endpoint || typeof endpoint !== "string" || !endpoint.startsWith("/")) {
    console.error("[useApi] Invalid endpoint:", endpoint);
    return null;
  }
  return `${API_URL}${endpoint}`;
}

export function useApi(endpoint) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchData = async () => {
    setLoading(true);
    setError(null);

    const url = buildUrl(endpoint);
    if (!url) {
      setLoading(false);
      return;
    }

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const headers = { "Content-Type": "application/json" };
      if (session) headers.Authorization = `Bearer ${session.access_token}`;
      if (import.meta.env.DEV) {
        console.log(
          `[useApi] GET ${url} — token:`,
          !!session,
          "auth header:",
          !!headers.Authorization,
        );
      }

      const res = await fetch(url, { headers });
      if (import.meta.env.DEV) {
        console.log("[useApi] Response:", {
          url,
          status: res.status,
          ok: res.ok,
        });
      }
      if (res.status === 304) {
        if (import.meta.env.DEV)
          console.log("[useApi] 304 — keeping existing data");
        return;
      }
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Request failed" }));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      const json = await res.json();
      setData(json);
    } catch (err) {
      console.error("[useApi] Failed to fetch:", url, err.message);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [endpoint]);

  return { data, loading, error, refetch: fetchData };
}
