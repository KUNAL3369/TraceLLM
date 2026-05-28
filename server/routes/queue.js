import { Router } from "express";
import { getQueue } from "../services/queueService.js";

const router = Router();

router.get("/status", async (_req, res) => {
  try {
    const queue = getQueue();
    if (!queue) {
      return res.json({
        enabled: false,
        message: "Queue not available (Redis not configured)",
      });
    }
    const [waiting, active, completed, failed, delayed] = await Promise.all([
      queue.getWaitingCount(),
      queue.getActiveCount(),
      queue.getCompletedCount(),
      queue.getFailedCount(),
      queue.getDelayedCount(),
    ]);
    res.json({
      enabled: true,
      waiting,
      active,
      completed,
      failed,
      delayed,
      total: waiting + active + completed + failed + delayed,
    });
  } catch {
    res.status(500).json({ error: "Failed to get queue status" });
  }
});

router.get("/failed", async (_req, res) => {
  try {
    const queue = getQueue();
    if (!queue) {
      return res.json({ enabled: false, jobs: [] });
    }
    const failed = await queue.getFailed(0, 50);
    res.json({
      enabled: true,
      count: failed.length,
      jobs: failed.map((j) => ({
        id: j.id,
        name: j.name,
        data: j.data,
        failedReason: j.failedReason,
        stacktrace: j.stacktrace,
        attemptsMade: j.attemptsMade,
        timestamp: j.timestamp,
        processedOn: j.processedOn,
        finishedOn: j.finishedOn,
      })),
    });
  } catch {
    res.status(500).json({ error: "Failed to get failed jobs" });
  }
});

router.post("/retry-all", async (_req, res) => {
  try {
    const queue = getQueue();
    if (!queue) return res.json({ enabled: false });
    const count = await queue.retryJobs(0, 100, "failed");
    res.json({ retried: count });
  } catch {
    res.status(500).json({ error: "Failed to retry jobs" });
  }
});

export default router;
