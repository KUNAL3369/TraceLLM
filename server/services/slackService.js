import { logger } from "./logger.js";

export async function sendSlackAlert(
  webhookUrl,
  { alertName, alertType, triggeredValue, threshold, projectName, timestamp },
) {
  if (!webhookUrl) return { success: false, reason: "No webhook URL" };

  const payload = {
    blocks: [
      {
        type: "header",
        text: {
          type: "plain_text",
          text: "🚨 TraceLLM Alert Triggered",
          emoji: true,
        },
      },
      {
        type: "section",
        fields: [
          { type: "mrkdwn", text: `*Alert:* ${alertName}` },
          { type: "mrkdwn", text: `*Project:* ${projectName}` },
          { type: "mrkdwn", text: `*Type:* ${alertType}` },
          {
            type: "mrkdwn",
            text: `*Value:* ${triggeredValue} (threshold: ${threshold})`,
          },
          {
            type: "mrkdwn",
            text: `*Time:* ${new Date(timestamp).toLocaleString()}`,
          },
        ],
      },
      {
        type: "actions",
        elements: [
          {
            type: "button",
            text: { type: "plain_text", text: "View Dashboard", emoji: true },
            url: `${process.env.APP_URL || "http://localhost:5173"}`,
            style: "primary",
          },
        ],
      },
    ],
  };

  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`Slack webhook returned ${res.status}`);
    return { success: true };
  } catch (err) {
    logger.error({ err }, "Slack alert error");
    return { success: false, error: err.message };
  }
}
