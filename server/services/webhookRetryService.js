import { supabase } from "../db/supabase.js";
import { logger } from "./logger.js";

/**
 * Webhook retry service — manages webhook delivery with exponential backoff.
 */
export async function createWebhookDelivery({ notificationId, projectId, eventType, payload }) {
  try {
    const { data, error } = await supabase.from("webhook_deliveries").insert({
      notification_id: notificationId,
      project_id: projectId,
      event_type: eventType,
      payload,
      status: "pending",
    }).select().single();

    if (error) throw error;
    return data;
  } catch (err) {
    logger.error({ err, projectId, eventType }, "Failed to create webhook delivery");
    return null;
  }
}

export async function processWebhookRetries() {
  const { data: pending } = await supabase
    .from("webhook_deliveries")
    .select("*, notification_settings!inner(*)")
    .in("status", ["pending", "failed"])
    .or(`next_retry_at.is.null,next_retry_at.lte.${new Date().toISOString()}`)
    .limit(20);

  if (!pending?.length) return;

  for (const delivery of pending) {
    const settings = delivery.notification_settings;
    if (!settings?.webhook_url) {
      await supabase.from("webhook_deliveries").update({ status: "failed" }).eq("id", delivery.id);
      continue;
    }

    const attempt = (delivery.attempt_count || 0) + 1;
    const maxAttempts = delivery.max_attempts || 3;

    await supabase.from("webhook_deliveries").update({
      status: "sending",
      attempt_count: attempt,
      last_attempt_at: new Date().toISOString(),
    }).eq("id", delivery.id);

    try {
      const res = await fetch(settings.webhook_url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event: delivery.event_type,
          payload: delivery.payload,
          attempt,
          delivery_id: delivery.id,
        }),
        signal: AbortSignal.timeout(10000),
      });

      const body = await res.text();

      if (res.ok) {
        await supabase.from("webhook_deliveries").update({
          status: "success",
          response_code: res.status,
          response_body: body?.slice(0, 2000),
          completed_at: new Date().toISOString(),
        }).eq("id", delivery.id);
      } else {
        throw new Error(`HTTP ${res.status}: ${body?.slice(0, 200)}`);
      }
    } catch (err) {
      const willRetry = attempt < maxAttempts;
      const nextRetry = willRetry
        ? new Date(Date.now() + Math.pow(2, attempt) * 1000).toISOString()
        : null;

      await supabase.from("webhook_deliveries").update({
        status: willRetry ? "failed" : "failed",
        response_body: err.message,
        next_retry_at: nextRetry,
      }).eq("id", delivery.id);

      if (!willRetry) {
        logger.warn({ deliveryId: delivery.id, eventType: delivery.event_type },
          "Webhook delivery exhausted all retries");
      }
    }
  }
}
