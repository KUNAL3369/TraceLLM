import { Router } from "express";
import { supabase } from "../db/supabase.js";
import { logger } from "../services/logger.js";

const router = Router();

const metrics = {
  requestsTotal: 0,
  requestsByRoute: {},
  latencyTotal: 0,
  latencyCount: 0,
  errorsTotal: 0,
  queueWaiting: 0,
  queueActive: 0,
  queueCompleted: 0,
  queueFailed: 0,
  queueDelayed: 0,
  activeUsers: new Set(),
  tokenUsageTotal: 0,
  startTime: Date.now(),
};

export function trackRequest(req, statusCode, durationMs) {
  metrics.requestsTotal++;
  const route = req.route?.path || req.originalUrl || "unknown";
  metrics.requestsByRoute[route] = (metrics.requestsByRoute[route] || 0) + 1;
  metrics.latencyTotal += durationMs;
  metrics.latencyCount++;
  if (statusCode >= 500) metrics.errorsTotal++;
  if (req.userId) metrics.activeUsers.add(req.userId);
}

export function trackTokens(count) {
  metrics.tokenUsageTotal += count || 0;
}

export function updateQueueMetrics(q) {
  metrics.queueWaiting = q.waiting || 0;
  metrics.queueActive = q.active || 0;
  metrics.queueCompleted = q.completed || 0;
  metrics.queueFailed = q.failed || 0;
  metrics.queueDelayed = q.delayed || 0;
}

router.get("/metrics", async (_req, res) => {
  const avgLatency =
    metrics.latencyCount > 0
      ? Math.round(metrics.latencyTotal / metrics.latencyCount)
      : 0;

  let dbConnected = false;
  try {
    const { data } = await supabase.from("projects").select("id").limit(1);
    dbConnected = Array.isArray(data);
  } catch {
    logger.warn("Internal metrics DB health check failed");
  }

  const { count: totalInferences } = await supabase
    .from("inference_logs")
    .select("*", { count: "exact", head: true })
    .limit(0);

  res.json({
    uptime_seconds: Math.round((Date.now() - metrics.startTime) / 1000),
    requests_total: metrics.requestsTotal,
    requests_per_second:
      avgLatency > 0
        ? (
            metrics.requestsTotal /
            ((Date.now() - metrics.startTime) / 1000)
          ).toFixed(2)
        : "0.00",
    avg_latency_ms: avgLatency,
    error_count: metrics.errorsTotal,
    error_rate_percent:
      metrics.requestsTotal > 0
        ? ((metrics.errorsTotal / metrics.requestsTotal) * 100).toFixed(2)
        : "0.00",
    active_users: metrics.activeUsers.size,
    total_inferences: totalInferences || 0,
    token_usage_total: metrics.tokenUsageTotal,
    queue: {
      waiting: metrics.queueWaiting,
      active: metrics.queueActive,
      completed: metrics.queueCompleted,
      failed: metrics.queueFailed,
      delayed: metrics.queueDelayed,
    },
    database: dbConnected ? "connected" : "disconnected",
    routes: metrics.requestsByRoute,
  });
});

export default router;
