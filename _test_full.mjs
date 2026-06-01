import "dotenv/config";
import express from "express";

const app = express();

app.get("/api/test", (req, res) => res.json({ ok: true }));

import alertsRouter from "./server/routes/alerts.js";
app.use("/api/alerts", alertsRouter);

import realtimeRouter from "./server/routes/realtime.js";
app.use("/api/realtime", realtimeRouter);

app.use((req, res) => {
  res.status(404).json({ error: "not found", path: req.path, baseUrl: req.baseUrl, originalUrl: req.originalUrl });
});

const s = app.listen(3096, async () => {
  const tests = [
    "/api/test",
    "/api/alerts/",
    "/api/alerts/events",
    "/api/realtime/metrics/stream",
  ];
  for (const url of tests) {
    const r = await fetch(`http://localhost:3096${url}`);
    console.log(r.status, url, (await r.text()).slice(0, 100));
  }
  s.close();
  process.exit(0);
});
