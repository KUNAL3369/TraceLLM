import { Router } from "express";
import { supabase } from "../db/supabase.js";
import { logAudit } from "../services/auditService.js";

const router = Router();

router.get("/", async (req, res) => {
  const { data: org } = await supabase
    .from("organizations")
    .select("id")
    .eq("owner_user_id", req.userId)
    .single();

  if (!org) return res.status(404).json({ error: "Organization not found" });

  const { data: subscription } = await supabase
    .from("subscriptions")
    .select("*")
    .eq("organization_id", org.id)
    .single();

  const { data: projects } = await supabase
    .from("projects")
    .select("id, name")
    .eq("organization_id", org.id);

  const projectIds = projects?.map((p) => p.id) || [];

  let totalUsage = 0;
  if (projectIds.length > 0) {
    const { data: usage } = await supabase
      .from("usage_tracking")
      .select("request_count")
      .in("project_id", projectIds);

    totalUsage = usage?.reduce((s, u) => s + (u.request_count || 0), 0) || 0;
  }

  return res.json({
    subscription: subscription || { plan: "free", monthly_limit: 1000, status: "active" },
    usage: totalUsage,
    projects: projects?.length || 0,
  });
});

router.post("/upgrade", async (req, res) => {
  const { plan } = req.body;
  if (!["pro", "growth"].includes(plan)) {
    return res.status(400).json({ error: "Invalid plan" });
  }

  const limits = { pro: 10000, growth: 100000 };

  const { data: org } = await supabase
    .from("organizations")
    .select("id")
    .eq("owner_user_id", req.userId)
    .single();

  if (!org) return res.status(404).json({ error: "Organization not found" });

  const { data, error } = await supabase
    .from("subscriptions")
    .upsert({
      organization_id: org.id,
      plan,
      monthly_limit: limits[plan],
      status: "active",
      billing_period_start: new Date().toISOString(),
      billing_period_end: new Date(Date.now() + 30 * 24 * 60 * 60000).toISOString(),
    })
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });

  await logAudit({
    userId: req.userId,
    action: "billing.upgraded",
    metadata: { plan, organization_id: org.id },
  });

  return res.json(data);
});

export default router;
