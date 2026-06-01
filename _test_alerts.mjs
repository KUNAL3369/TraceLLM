import express from "express";
import alertsRouter from "./server/routes/alerts.js";

const app = express();
app.use("/api/alerts", alertsRouter);

const s = app.listen(3097, async () => {
  const r = await fetch("http://localhost:3097/api/alerts/events");
  console.log("ALERTS ROUTER TEST:", r.status, await r.text());
  s.close();
  process.exit(0);
});
