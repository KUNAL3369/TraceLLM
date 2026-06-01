import { supabase } from "./supabase";
import { useProjectStore } from "../stores/projectStore";

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:3001";

let sessionCounter = Date.now();

export function createSession() {
  return `session_${sessionCounter++}`;
}

async function getHeaders() {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const headers = {
    "Content-Type": "application/json",
    ...(session ? { Authorization: `Bearer ${session.access_token}` } : {}),
  };
  if (import.meta.env.DEV) {
    console.log(
      "[SDK] Token present:",
      !!session,
      "Authorization set:",
      !!headers.Authorization,
    );
  }
  return headers;
}

function getProjectId() {
  try {
    return useProjectStore.getState().selectedProjectId || null;
  } catch {
    console.warn("[SDK] Failed to get project ID from store");
    return null;
  }
}

// Retry queue for failed ingestion attempts
const RETRY_BACKOFFS = [500, 1000, 2000];
let retryQueue = [];

function isRetryable(status) {
  if (!status) return true;
  return status >= 500 || status === 429;
}

async function fetchWithRetry(url, options, attempt = 0) {
  if (!url || typeof url !== "string") {
    console.error("[SDK] fetchWithRetry: invalid url —", url);
    throw new Error(`Invalid fetch URL: ${url}`);
  }
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(timeoutId);

    if (!res.ok && isRetryable(res.status) && attempt < RETRY_BACKOFFS.length) {
      await sleep(RETRY_BACKOFFS[attempt]);
      return fetchWithRetry(url, options, attempt + 1);
    }

    return res;
  } catch (err) {
    if (err.name === "AbortError" && attempt < RETRY_BACKOFFS.length) {
      await sleep(RETRY_BACKOFFS[attempt]);
      return fetchWithRetry(url, options, attempt + 1);
    }
    console.error("[SDK] fetchWithRetry error:", url, err.message);
    throw err;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function processRetryQueue() {
  if (retryQueue.length === 0) return;

  const batch = [...retryQueue];
  retryQueue = [];

  batch.forEach((payload) => {
    ingestLog(payload);
  });
}

export async function chatCompletion({
  messages,
  provider = "openai",
  model = "gpt-4o-mini",
  apiKey,
  sessionId,
  conversationId,
  onToken,
  signal,
}) {
  const startTime = performance.now();
  const requestPreview =
    messages[messages.length - 1]?.content?.slice(0, 200) || "";
  const headers = await getHeaders();

  try {
    const res = await fetch(`${API_BASE}/api/chat`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        messages,
        provider,
        model,
        apiKey,
        sessionId,
        conversationId,
        stream: !!onToken,
      }),
      signal,
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: "Request failed" }));
      throw new Error(err.error || `HTTP ${res.status}`);
    }

    if (
      onToken &&
      res.headers.get("content-type")?.includes("text/event-stream")
    ) {
      return handleStream(
        res,
        onToken,
        provider,
        model,
        startTime,
        sessionId,
        conversationId,
        requestPreview,
      );
    }

    const data = await res.json();
    const latency = Math.round(performance.now() - startTime);
    const responsePreview = data.content?.slice(0, 200) || "";

    ingestLog({
      provider,
      model,
      latency,
      prompt_tokens: data.usage?.prompt_tokens || 0,
      completion_tokens: data.usage?.completion_tokens || 0,
      total_tokens: data.usage?.total_tokens || 0,
      status: "success",
      requestPreview,
      responsePreview,
      sessionId,
      conversationId,
    });

    return data;
  } catch (err) {
    if (err.name === "AbortError") throw err;
    const latency = Math.round(performance.now() - startTime);
    ingestLog({
      provider,
      model,
      latency,
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0,
      status: "error",
      error_type: err.message,
      requestPreview,
      responsePreview: "",
      sessionId,
      conversationId,
    });
    throw err;
  }
}

async function handleStream(
  res,
  onToken,
  provider,
  model,
  startTime,
  sessionId,
  conversationId,
  requestPreview,
) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let fullContent = "";
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      if (line.startsWith("data: ")) {
        const data = line.slice(6);
        if (data === "[DONE]") break;
        try {
          const parsed = JSON.parse(data);
          if (parsed.error) throw new Error(parsed.error);
          const content = parsed.choices?.[0]?.delta?.content || "";
          fullContent += content;
          onToken(content);
        } catch (e) {
          if (e.message !== "skip") throw e;
        }
      }
    }
  }

  const latency = Math.round(performance.now() - startTime);
  ingestLog({
    provider,
    model,
    latency,
    prompt_tokens: 0,
    completion_tokens: fullContent.length,
    total_tokens: 0,
    status: "success",
    requestPreview,
    responsePreview: fullContent.slice(0, 200),
    sessionId,
    conversationId,
  });

  return { content: fullContent };
}

async function ingestLog({
  provider,
  model,
  latency,
  prompt_tokens,
  completion_tokens,
  total_tokens,
  status,
  error_type,
  requestPreview,
  responsePreview,
  sessionId,
  conversationId,
}) {
  const payload = {
    provider,
    model,
    latency_ms: latency,
    prompt_tokens,
    completion_tokens,
    total_tokens,
    status,
    error_type,
    request_preview: requestPreview,
    response_preview: responsePreview,
    session_id: sessionId,
    conversation_id: conversationId,
    project_id: getProjectId(),
  };

  try {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const ingestHeaders = { "Content-Type": "application/json" };
    if (session) ingestHeaders.Authorization = `Bearer ${session.access_token}`;
    if (import.meta.env.DEV) {
      console.log("[SDK] Ingest auth token present:", !!session);
    }
    const res = await fetchWithRetry(`${API_BASE}/api/ingest`, {
      method: "POST",
      headers: ingestHeaders,
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      if (import.meta.env.DEV) {
        console.warn("[SDK] Ingestion failed:", res.status, res.statusText);
      }
      retryQueue.push(payload);
      return;
    }

    processRetryQueue();
  } catch (err) {
    if (import.meta.env.DEV) {
      console.warn("[SDK] Ingestion error:", err.message);
    }
    retryQueue.push(payload);
  }
}
