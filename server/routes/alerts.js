import { Router } from "express";
import { supabase } from "../db/supabase.js";
import { z } from "zod";
import { logAudit } from "../services/auditService.js";
import { logger } from "../services/logger.js";

const router = Router();

const createAlertSchema = z.object({
  name: z.string().min(1).max(200),
  alert_type: z.enum([
    "latency_spike",
    "error_rate_spike",
    "token_burn_spike",
    "provider_outage",
    "throughput_drop",
  ]),
  threshold_value: z.number().positive(),
  comparison_operator: z.enum(["gt", "lt", "gte", "lte"]).default("gt"),
  time_window_minutes: z.number().int().positive().default(5),
  notification_channel: z
    .enum(["email", "slack", "webhook", "all"])
    .default("email"),
});

router.get("/", async (req, res) => {
  const { data, error } = await supabase
    .from("alerts")
    .select("*")
    .eq("project_id", req.query.project_id)
    .order("created_at", { ascending: false });

  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

router.get("/events", async (req, res) => {
  const { data, error } = await supabase
    .from("alert_events")
    .select("*, alerts(name, alert_type)")
    .eq("project_id", req.query.project_id)
    .order("triggered_at", { ascending: false })
    .limit(50);

  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

router.post("/", async (req, res) => {
  try {
    const parsed = createAlertSchema.parse(req.body);
    const { data, error } = await supabase
      .from("alerts")
      .insert({ ...parsed, project_id: req.body.project_id })
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });

    await logAudit({
      userId: req.userId,
      projectId: req.body.project_id,
      action: "alert.created",
      metadata: {
        alert_id: data.id,
        alert_name: data.name,
        alert_type: data.alert_type,
      },
    });

    return res.status(201).json(data);
  } catch (err) {
    if (err instanceof z.ZodError)
      return res
        .status(400)
        .json({ error: "Validation failed", details: err.errors });
    logger.error({ err }, "Create alert error");
    return res.status(500).json({ error: "Failed to create alert" });
  }
});

router.patch("/:id", async (req, res) => {
  const { data, error } = await supabase
    .from("alerts")
    .update(req.body)
    .eq("id", req.params.id)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });

  await logAudit({
    userId: req.userId,
    projectId: data.project_id,
    action: "alert.updated",
    metadata: { alert_id: data.id, changes: req.body },
  });

  return res.json(data);
});

router.delete("/:id", async (req, res) => {
  const { data: alert } = await supabase
    .from("alerts")
    .select("project_id")
    .eq("id", req.params.id)
    .single();
  if (!alert) return res.status(404).json({ error: "Alert not found" });

  await supabase.from("alert_events").delete().eq("alert_id", req.params.id);
  await supabase.from("alerts").delete().eq("id", req.params.id);

  await logAudit({
    userId: req.userId,
    projectId: alert.project_id,
    action: "alert.deleted",
    metadata: { alert_id: req.params.id },
  });

  return res.json({ success: true });
});

export default router;
