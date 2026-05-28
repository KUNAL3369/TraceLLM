import { supabase } from "../db/supabase.js";
import { logger } from "./logger.js";

/**
 * Daily usage quota tracking.
 */
export async function trackDailyUsage({ projectId, tokenCount = 0 }) {
  try {
    const today = new Date().toISOString().split("T")[0];

    // Upsert daily usage
    const { data: existing } = await supabase
      .from("daily_usage")
      .select("id, requests_count, tokens_count")
      .eq("project_id", projectId)
      .eq("date", today)
      .single();

    if (existing) {
      await supabase
        .from("daily_usage")
        .update({
          requests_count: existing.requests_count + 1,
          tokens_count: existing.tokens_count + tokenCount,
          updated_at: new Date().toISOString(),
        })
        .eq("id", existing.id);
    } else {
      await supabase.from("daily_usage").insert({
        project_id: projectId,
        date: today,
        requests_count: 1,
        tokens_count: tokenCount,
      });
    }
  } catch (err) {
    logger.error({ err, projectId }, "Failed to track daily usage");
  }
}

/**
 * Check daily usage against quotas.
 */
export async function checkDailyQuota({ projectId }) {
  try {
    const { data: quota } = await supabase
      .from("usage_quotas")
      .select("requests_per_day, tokens_per_day")
      .eq("project_id", projectId)
      .single();

    if (!quota) return { allowed: true };

    const today = new Date().toISOString().split("T")[0];
    const { data: usage } = await supabase
      .from("daily_usage")
      .select("requests_count, tokens_count")
      .eq("project_id", projectId)
      .eq("date", today)
      .single();

    if (!usage) return { allowed: true };

    const warnings = [];
    if (usage.requests_count >= quota.requests_per_day) {
      return { allowed: false, reason: "Daily request limit exceeded" };
    }
    if (usage.tokens_count >= quota.tokens_per_day) {
      return { allowed: false, reason: "Daily token limit exceeded" };
    }
    if (usage.requests_count >= quota.requests_per_day * 0.8) {
      warnings.push("Approaching daily request limit");
    }
    if (usage.tokens_count >= quota.tokens_per_day * 0.8) {
      warnings.push("Approaching daily token limit");
    }

    return { allowed: true, warnings };
  } catch (err) {
    logger.error({ err, projectId }, "Failed to check daily quota");
    return { allowed: true };
  }
}
