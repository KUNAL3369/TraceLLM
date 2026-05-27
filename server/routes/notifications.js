import { Router } from "express";
import { supabase } from "../db/supabase.js";

const router = Router();

router.get("/", async (req, res) => {
  const { data, error } = await supabase
    .from("notification_settings")
    .select("*")
    .eq("project_id", req.query.project_id)
    .single();

  if (error && error.code !== "PGRST116") return res.status(500).json({ error: error.message });
  return res.json(data || { email_enabled: true, slack_enabled: false });
});

router.put("/", async (req, res) => {
  const { slack_webhook_url, email_enabled, slack_enabled, webhook_url } = req.body;

  const { data, error } = await supabase
    .from("notification_settings")
    .upsert({
      project_id: req.body.project_id,
      slack_webhook_url: slack_webhook_url || null,
      email_enabled: email_enabled !== false,
      slack_enabled: slack_enabled || false,
      webhook_url: webhook_url || null,
    })
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

export default router;
