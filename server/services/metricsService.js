import { supabase } from "../db/supabase.js";
import { estimateTotalCost } from "./costService.js";

export async function getMetrics({ projectId, startDate, endDate }) {
  let query = supabase.from("inference_logs").select("*");

  if (projectId) query = query.eq("project_id", projectId);
  if (startDate) query = query.gte("created_at", startDate);
  if (endDate) query = query.lte("created_at", endDate);

  const { data, error } = await query;

  if (error) {
    console.error("Metrics query error:", error);
    return null;
  }

  if (!data || data.length === 0) return null;

  const total = data.length;
  const successes = data.filter((r) => r.status === "success").length;
  const failures = data.filter((r) => r.status === "error").length;
  const latencies = data.map((r) => r.latency_ms).sort((a, b) => a - b);
  const sumLatency = latencies.reduce((a, b) => a + b, 0);
  const p95Index = Math.ceil(latencies.length * 0.95) - 1;
  const sessions = new Set(data.filter((r) => r.session_id).map((r) => r.session_id));

  const totalPromptTokens = data.reduce((s, r) => s + (r.prompt_tokens || 0), 0);
  const totalCompletionTokens = data.reduce((s, r) => s + (r.completion_tokens || 0), 0);
  const totalTokens = data.reduce((s, r) => s + (r.total_tokens || 0), 0);

  const bucketSize = Math.max(1, Math.floor(data.length / 24));
  const trends = [];
  const sorted = [...data].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

  for (let i = 0; i < sorted.length; i += bucketSize) {
    const bucket = sorted.slice(i, i + bucketSize);
    const bucketLatencies = bucket.map((r) => r.latency_ms);
    trends.push({
      time: new Date(bucket[0].created_at).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }),
      requests: bucket.length,
      latency: Math.round(bucketLatencies.reduce((a, b) => a + b, 0) / bucketLatencies.length),
      tokens: bucket.reduce((s, r) => s + (r.total_tokens || 0), 0),
      errors: bucket.filter((r) => r.status === "error").length,
    });
  }

  const providerMap = {};
  data.forEach((r) => {
    providerMap[r.provider] = (providerMap[r.provider] || 0) + 1;
  });
  const providerTotal = Object.values(providerMap).reduce((a, b) => a + b, 0);
  const providers = Object.entries(providerMap).map(([name, value]) => ({
    name,
    value: Math.round((value / providerTotal) * 100),
  }));

  const modelMap = {};
  data.forEach((r) => {
    modelMap[r.model] = (modelMap[r.model] || 0) + 1;
  });
  const models = Object.entries(modelMap)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);

  const errorByType = {};
  data.filter((r) => r.status === "error" && r.error_type).forEach((r) => {
    errorByType[r.error_type] = (errorByType[r.error_type] || 0) + 1;
  });
  const errorBreakdown = Object.entries(errorByType).map(([name, value]) => ({ name, value }));

  const errorByProvider = {};
  data.filter((r) => r.status === "error").forEach((r) => {
    if (!errorByProvider[r.provider]) {
      errorByProvider[r.provider] = { provider: r.provider, timeout: 0, rate_limit: 0, invalid: 0, total: 0 };
    }
    const type = r.error_type || "unknown";
    if (type.includes("timeout")) errorByProvider[r.provider].timeout++;
    else if (type.includes("rate")) errorByProvider[r.provider].rate_limit++;
    else errorByProvider[r.provider].invalid++;
    errorByProvider[r.provider].total++;
  });

  return {
    summary: {
      total_requests: total,
      successful_requests: successes,
      failed_requests: failures,
      avg_latency: Math.round(sumLatency / total),
      p95_latency: latencies[p95Index] || 0,
      total_prompt_tokens: totalPromptTokens,
      total_completion_tokens: totalCompletionTokens,
      total_tokens: totalTokens,
      active_sessions: sessions.size,
      requests_per_minute: total > 0 ? Math.round(total / (bucketSize || 1)) : 0,
    },
    trends,
    providers,
    models,
    error_breakdown: errorBreakdown,
    errors_by_provider: Object.values(errorByProvider),
    cost: {
      estimated_total: estimateTotalCost(data),
      by_model: Object.entries(modelMap).map(([name]) => {
        const modelLogs = data.filter((r) => r.model === name);
        return {
          model: name,
          cost: estimateTotalCost(modelLogs),
        };
      }),
    },
  };
}
