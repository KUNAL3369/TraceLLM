import { Router } from "express";
import { subscribe, subscribeProject, Events } from "../services/eventBus.js";

const router = Router();

router.get("/metrics/stream", async (req, res) => {
  const projectId = req.query.project_id;

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  res.write(`data: ${JSON.stringify({ type: "connected" })}\n\n`);

  const heartbeat = setInterval(() => {
    res.write(`:heartbeat\n\n`);
  }, 15000);

  const unsubMetrics = projectId
    ? subscribeProject(Events.METRICS_UPDATE, projectId, (data) => {
        res.write(`data: ${JSON.stringify({ type: "metrics", data })}\n\n`);
      })
    : null;

  const unsubHealth = subscribe(Events.PROVIDER_HEALTH, (data) => {
    res.write(`data: ${JSON.stringify({ type: "provider_health", data })}\n\n`);
  });

  const unsubAlerts = projectId
    ? subscribeProject(Events.ALERT_EVENT, projectId, (data) => {
        res.write(`data: ${JSON.stringify({ type: "alert", data })}\n\n`);
      })
    : null;

  req.on("close", () => {
    clearInterval(heartbeat);
    unsubMetrics?.();
    unsubHealth?.();
    unsubAlerts?.();
  });
});

export default router;
