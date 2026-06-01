import "dotenv/config";
import express from "express";
import cookieParser from "cookie-parser";
import cors from "cors";

const app = express();
app.use(cors({ origin: "*" }));
app.use(express.json({ limit: "1mb" }));
app.use(cookieParser());

import alertsRouter from "./server/routes/alerts.js";

// Log all requests before routes
app.use((req, _res, next) => {
  console.log("INCOMING:", req.method, req.originalUrl);
  next();
});

app.use("/api/alerts", alertsRouter);

// 404 catch-all
app.use((req, res) => {
  console.log("404 FOR:", req.method, req.originalUrl);
  res.status(404).json({ error: "not found", originalUrl: req.originalUrl, path: req.path, baseUrl: req.baseUrl });
});

const s = app.listen(3095, async () => {
  const r = await fetch("http://localhost:3095/api/alerts/events");
  console.log("STATUS:", r.status, await r.text());
  s.close();
  process.exit(0);
});
