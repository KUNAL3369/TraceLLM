import { useState } from "react";
import { useApi } from "../hooks/useApi";
import { useProjectStore } from "../stores/projectStore";

export default function Conversations() {
  const selectedProjectId = useProjectStore((s) => s.selectedProjectId);
  const params = selectedProjectId ? `?project_id=${selectedProjectId}` : "";
  const { data: conversations, loading } = useApi(`/api/conversations${params}`);
  const [selected, setSelected] = useState(null);

  const selectedConv = selected && conversations?.find((c) => c.id === selected);

  return (
    <div className="flex h-[calc(100vh-3rem)] gap-4">
      <div className="flex-1 space-y-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Conversations</h1>
          <p className="text-sm text-gray-400">Session history and activity</p>
        </div>

        {loading && (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-20 animate-pulse rounded-2xl bg-[#1e293b]" />
            ))}
          </div>
        )}

        {!loading && (!conversations || conversations.length === 0) && (
          <div className="flex h-32 items-center justify-center rounded-2xl border border-white/10 bg-[#1e293b] text-sm text-gray-500">
            No conversations yet. Start a chat to see sessions here.
          </div>
        )}

        {!loading && conversations && (
          <div className="space-y-2">
            {conversations.map((conv) => (
              <button
                key={conv.id}
                onClick={() => setSelected(conv.id)}
                className={`w-full rounded-2xl border p-4 text-left transition-colors ${
                  selected === conv.id
                    ? "border-blue-500 bg-blue-600/10"
                    : "border-white/10 bg-[#1e293b] hover:bg-[#1e293b]/80"
                }`}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-sm font-medium text-white">{conv.session_id || conv.id.slice(0, 8)}</span>
                    <span className="ml-2 text-xs text-gray-500">
                      {conv.inference_logs?.[0]?.provider || "—"} · {conv.inference_logs?.[0]?.model || "—"}
                    </span>
                  </div>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                    conv.status === "active"
                      ? "bg-green-900/30 text-green-400"
                      : "bg-gray-900/30 text-gray-400"
                  }`}>
                    {conv.status}
                  </span>
                </div>
                <div className="mt-1 flex gap-4 text-xs text-gray-500">
                  <span>{conv.messages?.[0]?.count || 0} messages</span>
                  <span>{conv.inference_logs?.reduce((s, l) => s + (l.total_tokens || 0), 0)} tokens</span>
                  <span>{new Date(conv.last_activity_at).toLocaleString()}</span>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {selectedConv && (
        <div className="w-96 rounded-2xl border border-white/10 bg-[#1e293b] p-4">
          <h3 className="text-sm font-medium text-white">{selectedConv.session_id || "Conversation"}</h3>
          <div className="mt-1 text-xs text-gray-500">
            Started: {new Date(selectedConv.started_at).toLocaleString()}
          </div>
          <div className="mt-4 max-h-[60vh] space-y-3 overflow-y-auto">
            {selectedConv.messages?.length > 0 ? (
              selectedConv.messages.map((msg, i) => (
                <div key={msg.id || i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                  <div className={`rounded-xl px-3 py-2 text-xs max-w-[80%] ${
                    msg.role === "user" ? "bg-blue-600 text-white" : "bg-[#0f172a] text-gray-300"
                  }`}>
                    <div className="whitespace-pre-wrap break-words">{msg.content_preview || "(empty)"}</div>
                  </div>
                </div>
              ))
            ) : (
              <div className="text-center text-xs text-gray-500">No messages recorded</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
