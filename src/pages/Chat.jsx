import { useState, useRef, useEffect, useCallback } from "react";
import { chatCompletion, createSession } from "../lib/sdk";
import { supabase } from "../lib/supabase";

const PROVIDERS = [
  {
    id: "openrouter",
    name: "OpenRouter",
    models: [
      "meta-llama/llama-3.3-70b-instruct:free",
      "openai/gpt-oss-20b:free",
      "openai/gpt-oss-120b:free",
      "nvidia/nemotron-nano-9b-v2:free",
      "qwen/qwen3-coder:free",
    ],
  },
  {
    id: "openai",
    name: "OpenAI",
    models: ["gpt-4o-mini", "gpt-4o", "gpt-4-turbo"],
  },
  {
    id: "anthropic",
    name: "Anthropic",
    models: [
      "claude-3-haiku-20240307",
      "claude-3-sonnet-20240229",
      "claude-3-opus-20240229",
    ],
  },
  {
    id: "groq",
    name: "Groq",
    models: [
      "llama-3.3-70b-versatile",
      "llama-3.1-8b-instant",
      "deepseek-r1-distill-llama-70b",
    ],
  },
];

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3001";

async function getHeaders() {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  return {
    "Content-Type": "application/json",
    ...(session ? { Authorization: `Bearer ${session.access_token}` } : {}),
  };
}

async function fetchWithAuth(url, options = {}) {
  const headers = await getHeaders();
  const res = await fetch(`${API_URL}${url}`, {
    ...options,
    headers: { ...headers, ...options.headers },
  });
  if (!res.ok) throw new Error(`Request failed: ${res.status}`);
  return res.json();
}

export default function Chat() {
  const [conversations, setConversations] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [abortController, setAbortController] = useState(null);
  const [provider, setProvider] = useState("openrouter");
  const [model, setModel] = useState("meta-llama/llama-3.3-70b-instruct:free");
  const [loading, setLoading] = useState(true);
  const messagesEndRef = useRef(null);

  const active = conversations.find((c) => c.id === activeId);
  const currentProvider = PROVIDERS.find((p) => p.id === provider);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [active?.messages]);

  useEffect(() => {
    loadConversations();
  }, []);

  async function loadConversations() {
    try {
      const data = await fetchWithAuth("/api/conversations?status=active");
      setConversations(data);
      if (data.length > 0) {
        setActiveId(data[0].id);
      }
    } catch {
      console.warn("[Chat] Failed to load conversations");
      setConversations([]);
    } finally {
      setLoading(false);
    }
  }

  async function loadConversation(id) {
    try {
      const data = await fetchWithAuth(`/api/conversations/${id}`);
      setConversations((prev) =>
        prev.map((c) =>
          c.id === id ? { ...c, messages: data.messages || [] } : c,
        ),
      );
    } catch {
      console.warn("[Chat] Failed to load conversation messages");
    }
  }

  useEffect(() => {
    if (activeId && !active?.messages?.length) {
      loadConversation(activeId);
    }
  }, [activeId]);

  async function persistMessage(convId, role, content, tokenCount) {
    try {
      await fetchWithAuth(`/api/conversations/${convId}/messages`, {
        method: "POST",
        body: JSON.stringify({ role, content, token_count: tokenCount || 0 }),
      });
    } catch {
      console.warn("[Chat] Failed to persist message");
    }
  }

  const sendMessage = useCallback(async () => {
    if (!input.trim() || streaming) return;
    const msg = input.trim();
    setInput("");

    let convId = activeId;
    let sessionId = active?.sessionId || createSession();

    if (!convId || convId === "new") {
      try {
        const newConv = await fetchWithAuth("/api/conversations", {
          method: "POST",
          body: JSON.stringify({ project_id: "dev", session_id: sessionId }),
        });
        convId = newConv.id;
        setActiveId(convId);
        setConversations((prev) => [
          { ...newConv, messages: [], title: "New Chat" },
          ...prev,
        ]);
      } catch {
        console.warn(
          "[Chat] Failed to create conversation, using local fallback",
        );
        convId = `local_${Date.now()}`;
        setActiveId(convId);
        setConversations((prev) => [
          { id: convId, messages: [], sessionId, title: "New Chat (offline)" },
          ...prev,
        ]);
      }
    }

    const userMsg = { role: "user", content: msg };

    setConversations((prev) =>
      prev.map((c) =>
        c.id === convId
          ? { ...c, messages: [...(c.messages || []), userMsg] }
          : c,
      ),
    );

    await persistMessage(convId, "user", msg);

    const conv = conversations.find((c) => c.id === convId);
    const existingMessages = conv?.messages || [];
    const apiMessages = [...existingMessages, userMsg].map((m) => ({
      role: m.role,
      content: typeof m.content === "string" ? m.content : "",
    }));

    const controller = new AbortController();
    setAbortController(controller);
    setStreaming(true);

    const assistantMsg = { role: "assistant", content: "" };
    setConversations((prev) =>
      prev.map((c) =>
        c.id === convId
          ? { ...c, messages: [...(c.messages || []), assistantMsg] }
          : c,
      ),
    );

    try {
      await chatCompletion({
        messages: apiMessages,
        provider,
        model,
        sessionId,
        conversationId: convId,
        signal: controller.signal,
        onToken: (token) => {
          setConversations((prev) =>
            prev.map((c) =>
              c.id === convId
                ? {
                    ...c,
                    messages: c.messages.map((m, i) =>
                      i === c.messages.length - 1
                        ? { ...m, content: m.content + token }
                        : m,
                    ),
                  }
                : c,
            ),
          );
        },
      });

      const finalConv = conversations.find((c) => c.id === convId);
      const lastMsg = finalConv?.messages?.[finalConv.messages.length - 1];
      if (lastMsg?.content) {
        await persistMessage(convId, "assistant", lastMsg.content);
      }
    } catch (err) {
      if (err.name !== "AbortError") {
        setConversations((prev) =>
          prev.map((c) =>
            c.id === convId
              ? {
                  ...c,
                  messages: c.messages.map((m, i) =>
                    i === c.messages.length - 1
                      ? { ...m, content: `Error: ${err.message}` }
                      : m,
                  ),
                }
              : c,
          ),
        );
      }
    } finally {
      setStreaming(false);
      setAbortController(null);
    }
  }, [input, streaming, activeId, conversations, provider, model]);

  const cancelStream = () => {
    abortController?.abort();
    setStreaming(false);
  };

  const startNewChat = () => {
    const id = "new";
    setActiveId(id);
    setProvider("openrouter");
    setModel("meta-llama/llama-3.3-70b-instruct:free");
  };

  function handleProviderChange(newProvider) {
    setProvider(newProvider);
    const prov = PROVIDERS.find((x) => x.id === newProvider);
    if (prov) setModel(prov.models[0]);
  }

  if (loading) {
    return (
      <div className="flex h-[calc(100vh-3rem)] items-center justify-center text-gray-500">
        Loading conversations...
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-3rem)] gap-4">
      <div className="flex w-64 flex-col rounded-2xl border border-white/10 bg-[#1e293b]">
        <div className="border-b border-white/10 p-3">
          <button
            onClick={startNewChat}
            className="w-full rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            + New Chat
          </button>
        </div>
        <div className="flex-1 space-y-1 overflow-y-auto p-2">
          {conversations.length === 0 && (
            <div className="px-3 py-4 text-center text-xs text-gray-500">
              No conversations yet
            </div>
          )}
          {conversations.map((c) => {
            const lastMsg = c.messages?.[c.messages.length - 1];
            const preview =
              lastMsg?.role === "user" ? lastMsg.content?.slice(0, 40) : "";
            const msgCount = c.messages?.length || 0;
            return (
              <button
                key={c.id}
                onClick={async () => {
                  setActiveId(c.id);
                  if (!c.messages?.length && c.id !== "new") {
                    await loadConversation(c.id);
                  }
                }}
                className={`w-full truncate rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                  c.id === activeId
                    ? "bg-blue-600/20 text-blue-300"
                    : "text-gray-400 hover:bg-[#0f172a] hover:text-white"
                }`}
              >
                <div className="truncate">
                  {preview || c.user_identifier || "New Chat"}
                </div>
                {msgCount > 0 && (
                  <span className="text-xs text-gray-600">
                    {msgCount} messages
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex flex-1 flex-col rounded-2xl border border-white/10 bg-[#1e293b]">
        <div className="flex items-center justify-between border-b border-white/10 px-4 py-2">
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500">Provider:</span>
            <select
              value={provider}
              onChange={(e) => handleProviderChange(e.target.value)}
              disabled={streaming}
              className="rounded-lg border border-white/10 bg-[#0f172a] px-2 py-1 text-xs text-white focus:border-blue-500 focus:outline-none"
            >
              {PROVIDERS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <span className="text-xs text-gray-500">Model:</span>
            <select
              value={model}
              onChange={(e) => setModel(e.target.value)}
              disabled={streaming}
              className="rounded-lg border border-white/10 bg-[#0f172a] px-2 py-1 text-xs text-white focus:border-blue-500 focus:outline-none"
            >
              {currentProvider?.models.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>
          <span className="text-xs text-gray-600">
            {streaming ? "Streaming..." : "Ready"}
          </span>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-4">
          {(!active || active.messages?.length === 0) && (
            <div className="flex h-full items-center justify-center text-sm text-gray-500">
              Send a message to start monitoring LLM inference
            </div>
          )}
          {active?.messages?.map((msg, i) => (
            <div
              key={i}
              className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[75%] rounded-2xl px-4 py-2 text-sm ${
                  msg.role === "user"
                    ? "bg-blue-600 text-white"
                    : "bg-[#0f172a] text-gray-200"
                }`}
              >
                <div className="whitespace-pre-wrap">
                  {msg.content ||
                    (streaming && i === active.messages.length - 1
                      ? "..."
                      : "")}
                </div>
              </div>
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>

        <div className="border-t border-white/10 p-4">
          <div className="flex gap-2">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) =>
                e.key === "Enter" && !e.shiftKey && sendMessage()
              }
              placeholder="Type a message..."
              disabled={streaming}
              className="flex-1 rounded-xl border border-white/10 bg-[#0f172a] px-4 py-2 text-sm text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none disabled:opacity-50"
            />
            {streaming ? (
              <button
                onClick={cancelStream}
                className="rounded-xl bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
              >
                Stop
              </button>
            ) : (
              <button
                onClick={sendMessage}
                disabled={!input.trim()}
                className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                Send
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
