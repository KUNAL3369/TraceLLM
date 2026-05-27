import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
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
import { startIngestWorker } from "./services/queueService.js";
import { supabase } from "./db/supabase.js";

const app = express();
const PORT = process.env.PORT || 3001;
const FRONTEND_URL = process.env.VITE_FRONTEND_URL || process.env.APP_URL || "http://localhost:5173";

const REQUIRED_ENV = [
  "VITE_SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
];

for (const key of REQUIRED_ENV) {
  if (!process.env[key]) {
    console.error(`Missing required env var: ${key}`);
    process.exit(1);
  }
}

app.use(helmet());
app.use(cors({ origin: FRONTEND_URL, credentials: true }));
app.use(express.json({ limit: "1mb" }));
app.use(morgan("short"));

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
app.set("trust proxy", 1);

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", service: "TraceLLM API", version: "2.0.0" });
});

app.use("/api/projects", userAuth, projectsRouter);
app.use("/api/conversations", userAuth, conversationsRouter);
app.use("/api/alerts", userAuth, alertsRouter);
app.use("/api/billing", userAuth, billingRouter);
app.use("/api/audit", userAuth, auditRouter);
app.use("/api/notifications", userAuth, notificationsRouter);
app.use("/api/metrics", userAuth, metricsRouter);
app.use("/api/chat", userAuth, chatRouter);
app.use("/api/provider-health", userAuth, providerHealthHandler);
app.use("/api/ingest", ingestLimiter, apiKeyAuth, ingestRouter);

app.use((err, _req, res, _next) => {
  console.error("Unhandled error:", err);
  res.status(500).json({ error: "Internal server error" });
});

cron.schedule("*/2 * * * *", () => {
  evaluateAllAlerts().catch((err) => console.error("[Cron] Alert evaluation failed:", err));
});

app.listen(PORT, () => {
  console.log(`TraceLLM API running on http://localhost:${PORT}`);
  console.log(`CORS origin: ${FRONTEND_URL}`);
});

startIngestWorker();

async function providerHealthHandler(_req, res) {
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
}
