import express from "express";
import cors from "cors";
import process from "node:process";
import "dotenv/config";
import rateLimit from "express-rate-limit";
import cron from "node-cron";

import ingestRouter from "./routes/ingest.js";
import chatRouter from "./routes/chat.js";
import metricsRouter from "./routes/metrics.js";
import projectsRouter from "./routes/projects.js";
import conversationsRouter from "./routes/conversations.js";
import alertsRouter from "./routes/alerts.js";
import billingRouter from "./routes/billing.js";
import auditRouter from "./routes/audit.js";
import notificationsRouter from "./routes/notifications.js";
import { userAuth, apiKeyAuth } from "./middleware/apiKeyAuth.js";
import { evaluateAllAlerts } from "./services/alertEvaluator.js";

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json({ limit: "1mb" }));

const generalLimiter = rateLimit({
  windowMs: 60000,
  max: 100,
  message: { error: "Too many requests" },
});

const ingestLimiter = rateLimit({
  windowMs: 60000,
  max: 300,
  message: { error: "Ingestion rate limit exceeded" },
});

app.use("/api", generalLimiter);
app.use("/api/ingest", ingestLimiter);

app.use("/api/projects", userAuth, projectsRouter);
app.use("/api/conversations", userAuth, conversationsRouter);
app.use("/api/alerts", userAuth, alertsRouter);
app.use("/api/billing", userAuth, billingRouter);
app.use("/api/audit", userAuth, auditRouter);
app.use("/api/notifications", userAuth, notificationsRouter);
app.use("/api/metrics", metricsRouter);
app.use("/api/ingest", apiKeyAuth, ingestRouter);
app.use("/api/chat", chatRouter);

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", service: "TraceLLM API", version: "2.0.0" });
});

app.get("/api/provider-health", async (_req, res) => {
  const now = new Date();
  const fiveMinAgo = new Date(now - 5 * 60000).toISOString();

  const providers = ["openai", "anthropic", "groq"];
  const health = [];

  for (const provider of providers) {
    const { data: recent } = await supabase
      .from("inference_logs")
      .select("status, latency_ms")
      .eq("provider", provider)
      .gte("created_at", fiveMinAgo)
      .limit(100);

    const total = recent?.length || 0;
    const errors = recent?.filter((r) => r.status === "error").length || 0;
    const avgLatency = total > 0
      ? Math.round(recent.reduce((s, r) => s + (r.latency_ms || 0), 0) / total)
      : 0;

    let status = "healthy";
    if (total === 0) status = "unknown";
    else if (errors / total > 0.3) status = "down";
    else if (errors / total > 0.1) status = "degraded";

    health.push({
      provider,
      status,
      avg_latency_ms: avgLatency,
      success_rate: total > 0 ? Math.round(((total - errors) / total) * 100) : 0,
      recent_requests: total,
      recent_errors: errors,
    });
  }

  res.json(health);
});

// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  console.error("Unhandled error:", err);
  res.status(500).json({ error: "Internal server error" });
});

cron.schedule("*/2 * * * *", () => {
  console.log("[Cron] Evaluating alerts...");
  evaluateAllAlerts().catch((err) => console.error("[Cron] Alert evaluation failed:", err));
});

app.listen(PORT, () => {
  console.log(`TraceLLM API running on http://localhost:${PORT}`);
});

import { startIngestWorker } from "./services/queueService.js";
import { supabase } from "./db/supabase.js";

startIngestWorker();
