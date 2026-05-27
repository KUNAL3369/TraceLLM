import { supabase } from "../db/supabase.js";
import { redactLogPayload } from "./piiRedaction.js";

export async function trackUsage({ projectId, requestCount = 1, tokenCount = 0, costEstimate = 0 }) {
  const now = new Date();
  const periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);

  const { data: existing } = await supabase
    .from("usage_tracking")
    .select("id, request_count, token_count, cost_estimate")
    .eq("project_id", projectId)
    .gte("period_start", periodStart.toISOString())
    .lte("period_end", periodEnd.toISOString())
    .maybeSingle();

  if (existing) {
    await supabase
      .from("usage_tracking")
      .update({
        request_count: existing.request_count + requestCount,
        token_count: existing.token_count + tokenCount,
        cost_estimate: (existing.cost_estimate || 0) + costEstimate,
      })
      .eq("id", existing.id);
  } else {
    await supabase.from("usage_tracking").insert({
      project_id: projectId,
      request_count: requestCount,
      token_count: tokenCount,
      cost_estimate: costEstimate,
      period_start: periodStart.toISOString(),
      period_end: periodEnd.toISOString(),
    });
  }
}

export async function checkUsageLimit(projectId) {
  const { data: project } = await supabase
    .from("projects")
    .select("organization_id")
    .eq("id", projectId)
    .single();

  if (!project) return { allowed: false, reason: "Project not found" };

  const { data: subscription } = await supabase
    .from("subscriptions")
    .select("plan, monthly_limit, billing_period_end")
    .eq("organization_id", project.organization_id)
    .eq("status", "active")
    .single();

  if (!subscription) return { allowed: true };

  if (new Date(subscription.billing_period_end) < new Date()) {
    return { allowed: false, reason: "Billing period expired", plan: subscription.plan };
  }

  const now = new Date();
  const periodStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const { data: usage } = await supabase
    .from("usage_tracking")
    .select("request_count")
    .eq("project_id", projectId)
    .gte("period_start", periodStart.toISOString())
    .maybeSingle();

  const currentUsage = usage?.request_count || 0;
  if (currentUsage >= subscription.monthly_limit) {
    return { allowed: false, reason: "Monthly limit exceeded", limit: subscription.monthly_limit, usage: currentUsage, plan: subscription.plan };
  }

  return { allowed: true, usage: currentUsage, limit: subscription.monthly_limit, plan: subscription.plan };
}
