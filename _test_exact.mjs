import "dotenv/config";
import "./server/services/tracer.js";
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";

const app = express();
app.use(cors({ origin: "*" }));
app.use(express.json({ limit: "1mb" }));
app.use(cookieParser());

// Debug
app.use((req, _res, next) => {
  console.log("REQ:", req.method, req.originalUrl);
  next();
});

import alertsRouter from "./server/routes/alerts.js";
import { userAuth } from "./server/middleware/apiKeyAuth.js";
import realtimeRouter from "./server/routes/realtime.js";
import metricsRouter from "./server/routes/metrics.js";

app.get("/api/health", (req, res) => res.json({ ok: true }));
app.use("/api/alerts", userAuth, alertsRouter);
app.use("/api/realtime", userAuth, realtimeRouter);
app.use("/api/metrics", userAuth, metricsRouter);

app.use((req, res) => {
  console.log("404:", req.method, req.originalUrl);
  res.status(404).json({ error: "not found", url: req.originalUrl });
});

app.use((err, req, res, _next) => {
  console.log("ERROR:", err.message);
  res.status(500).json({ error: err.message });
});

const s = app.listen(3094, async () => {
  const tests = [
    { url: "/api/health", headers: {} },
    { url: "/api/alerts/events", headers: { Authorization: "Bearer x" } },
    { url: "/api/realtime/metrics/stream", headers: { Authorization: "Bearer x" } },
  ];
  for (const { url, headers } of tests) {
    const r = await fetch(`http://localhost:3094${url}`, { headers });
    console.log(r.status, url, (await r.text()).slice(0, 100));
  }
  s.close();
  process.exit(0);
});
