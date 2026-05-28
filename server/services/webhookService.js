import { logger } from "./logger.js";

export async function sendWebhookAlert(webhookUrl, payload) {
  if (!webhookUrl) return { success: false, reason: "No webhook URL" };

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event: "alert.triggered",
        project: payload.projectName,
        alert_type: payload.alertType,
        alert_name: payload.alertName,
        metric: payload.triggeredValue,
        threshold: payload.threshold,
        timestamp: payload.timestamp,
        dashboard_url: `${process.env.APP_URL || "http://localhost:5173"}`,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);
    if (!res.ok) throw new Error(`Webhook returned ${res.status}`);
    return { success: true };
  } catch (err) {
    logger.error({ err, webhookUrl }, "Webhook alert error");
    return { success: false, error: err.message };
  }
}
