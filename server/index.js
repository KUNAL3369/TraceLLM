import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import cookieParser from "cookie-parser";
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
import realtimeRouter from "./routes/realtime.js";
import queueRouter from "./routes/queue.js";
import internalRouter from "./routes/internal.js";
import { userAuth, apiKeyAuth } from "./middleware/apiKeyAuth.js";
import { requestId } from "./middleware/requestId.js";
import { requestTiming } from "./middleware/requestTiming.js";
import { evaluateAllAlerts } from "./services/alertEvaluator.js";
import { startIngestWorker, shutdownQueue } from "./services/queueService.js";
import { supabase } from "./db/supabase.js";
import { getMetrics } from "./services/metricsService.js";
import { emitMetricsUpdate, emitProviderHealth } from "./services/eventBus.js";
import { logger, requestLogger } from "./services/logger.js";
import { trackRequest } from "./routes/internal.js";

const app = express();
const PORT = process.env.PORT || 3001;
const FRONTEND_URL = process.env.VITE_FRONTEND_URL || process.env.APP_URL || "http://localhost:5173";
const isProduction = process.env.NODE_ENV === "production";

const REQUIRED_ENV = [
  "VITE_SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
];

for (const key of REQUIRED_ENV) {
  if (!process.env[key]) {
    logger.fatal({ key }, "Missing required env var");
    process.exit(1);
  }
}

// Request ID — every request gets a unique UUID
app.use(requestId);

// Request timing — measures DB and total duration
app.use(requestTiming);

// Security headers
app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: false,
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", isProduction ? "" : "'unsafe-inline'", "'unsafe-eval'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: [
        "'self'",
        FRONTEND_URL,
        process.env.VITE_SUPABASE_URL || "",
        "https://api.openai.com",
        "https://api.anthropic.com",
        "https://api.groq.com",
        "https://openrouter.ai",
      ].filter(Boolean),
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      mediaSrc: ["'none'"],
      frameSrc: ["'none'"],
      formAction: ["'self'"],
      baseUri: ["'self'"],
      reportUri: isProduction ? "/api/csp-report" : null,
    },
  },
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: "cross-origin" },
}));

app.use(cors({
  origin: FRONTEND_URL,
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "x-api-key", "x-csrf-token"],
  exposedHeaders: ["X-Request-Id", "X-Response-Time-MS", "X-DB-Time-MS"],
}));

app.use(express.json({ limit: "1mb" }));
app.use(cookieParser());

// Structured request logging — replaces morgan
app.use(requestLogger);

// Add request ID to responses
app.use((req, res, next) => {
  res.setHeader("X-Request-Id", req.id);
  next();
});

const generalLimiter = rateLimit({
  windowMs: 60000,
  max: 100,
  message: { error: "Too many requests" },
  standardHeaders: true,
  legacyHeaders: false,
});

const ingestLimiter = rateLimit({
  windowMs: 60000,
  max: 300,
  message: { error: "Ingestion rate limit exceeded" },
  standardHeaders: true,
  legacyHeaders: false,
});

app.use("/api", generalLimiter);
app.set("trust proxy", 1);

const startTime = Date.now();

app.get("/api/health", async (_req, res) => {
  let dbOk = false;
  try {
    const { data } = await supabase.from("projects").select("id").limit(1);
    dbOk = Array.isArray(data);
  } catch {
    // DB check failed — respond with degraded status
  }
  res.json({
    status: dbOk ? "ok" : "degraded",
    service: "TraceLLM API",
    version: "2.0.0",
    uptime_ms: Date.now() - startTime,
    database: dbOk ? "connected" : "disconnected",
  });
});

// CSP report endpoint
app.post("/api/csp-report", (req, res) => {
  logger.warn({ cspReport: req.body }, "CSP violation reported");
  res.status(204).end();
});

// Internal/admin routes (protected)
app.use("/api/queue", userAuth, queueRouter);
app.use("/api/internal", userAuth, internalRouter);

// Dashboard routes with auth
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
app.use("/api/realtime", userAuth, realtimeRouter);

// Request tracking — runs after all routes
app.use((req, res, next) => {
  const originalEnd = res.end;
  res.end = function (...args) {
    trackRequest(req, res.statusCode, req._timing?.total || 0);
    originalEnd.apply(res, args);
  };
  next();
});

// Global error handler
app.use((err, req, res, _next) => {
  logger.error({ err }, "Unhandled error");
  res.status(500).json({ error: "Internal server error" });
});

// Cron: Alert evaluation every 2 minutes
cron.schedule("*/2 * * * *", () => {
  evaluateAllAlerts().catch((err) => logger.error({ err }, "[Cron] Alert evaluation failed"));
});

// Cron: Metrics broadcast every 10 seconds
cron.schedule("*/10 * * * * *", async () => {
  try {
    const { data: projects } = await supabase.from("projects").select("id").limit(50);
    if (projects) {
      for (const project of projects) {
        const data = await getMetrics({ projectId: project.id });
        if (data) emitMetricsUpdate(project.id, data);
      }
    }
    const healthRes = await fetch(`http://localhost:${PORT}/api/provider-health`);
    if (healthRes.ok) emitProviderHealth(await healthRes.json());
  } catch (err) {
    logger.error({ err }, "[Cron] Metrics broadcast error");
  }
});

const server = app.listen(PORT, () => {
  logger.info({ port: PORT, frontendUrl: FRONTEND_URL }, "TraceLLM API started");
});

startIngestWorker();

// Graceful shutdown
async function shutdown(signal) {
  logger.info({ signal }, "Shutdown signal received");
  server.close(() => {
    logger.info("HTTP server closed");
  });
  await shutdownQueue();
  logger.info("Shutdown complete");
  process.exit(0);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

async function providerHealthHandler(_req, res) {
  const now = new Date();
  const fiveMinAgo = new Date(now - 5 * 60000).toISOString();
  const providers = ["openai", "anthropic", "groq", "openrouter"];
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
