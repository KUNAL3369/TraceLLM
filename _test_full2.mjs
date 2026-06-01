import "dotenv/config";
import "./server/services/tracer.js";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import cookieParser from "cookie-parser";

import alertsRouter from "./server/routes/alerts.js";
import { userAuth } from "./server/middleware/apiKeyAuth.js";
import { requestId } from "./server/middleware/requestId.js";
import { requestTiming } from "./server/middleware/requestTiming.js";
import { logger, requestLogger } from "./server/services/logger.js";

const app = express();
const PORT = 3093;
const FRONTEND_URL = "http://localhost:5173";
const isProduction = true;

app.use(requestId);
app.use(requestTiming);

app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: false,
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'", FRONTEND_URL].filter(Boolean),
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      mediaSrc: ["'none'"],
      frameSrc: ["'none'"],
      formAction: ["'self'"],
      baseUri: ["'self'"],
    },
  },
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: "cross-origin" },
}));

app.use(cors({ origin: FRONTEND_URL, credentials: true }));
app.use(express.json({ limit: "1mb" }));
app.use(cookieParser());
app.use(requestLogger);

app.use((req, res, next) => {
  res.setHeader("X-Request-Id", req.id);
  next();
});

const generalLimiter = rateLimit({
  windowMs: 60000, max: 100,
  message: { error: "Too many requests" },
  standardHeaders: true, legacyHeaders: false,
});
app.use("/api", generalLimiter);
app.set("trust proxy", 1);

app.get("/api/health", (req, res) => res.json({ ok: true, id: req.id }));

// Route mount
app.use("/api/alerts", userAuth, alertsRouter);

// 404 catch-all (BEFORE error handler, AFTER routes)
app.use((req, res) => {
  const msg = `NOT FOUND: ${req.method} ${req.originalUrl} path=${req.path} base=${req.baseUrl}`;
  logger.warn(msg);
  res.status(404).json({ error: msg });
});

app.use((err, req, res, _next) => {
  logger.error({ err }, "Unhandled error");
  res.status(500).json({ error: "Internal server error" });
});

const s = app.listen(PORT, async () => {
  logger.info({ port: PORT }, "Started");
  const tests = [
    "/api/health",
    "/api/alerts/events",
  ];
  for (const url of tests) {
    const r = await fetch(`http://localhost:${PORT}${url}`, {
      headers: { Authorization: "Bearer x" },
    });
    console.log(r.status, url, await r.text());
  }
  s.close();
  process.exit(0);
});
