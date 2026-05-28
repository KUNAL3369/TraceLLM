import { Router } from "express";
import { getMetrics } from "../services/metricsService.js";
import { logger } from "../services/logger.js";

const router = Router();

router.get("/", async (req, res) => {
  try {
    const { project_id, start_date, end_date } = req.query;

    if (!project_id) {
      return res.json(null);
    }

    const data = await getMetrics({
      projectId: project_id,
      startDate: start_date,
      endDate: end_date,
    });

    return res.json(data || null);
  } catch (err) {
    logger.error({ err }, "Metrics error");
    return res.status(500).json({ error: "Failed to fetch metrics" });
  }
});

export default router;
