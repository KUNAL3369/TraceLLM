import { supabase } from "../db/supabase.js";
import { getMetrics } from "./metricsService.js";
import { sendEmail, buildAlertEmail } from "./emailService.js";
import { sendSlackAlert } from "./slackService.js";
import { sendWebhookAlert } from "./webhookService.js";
import { logger } from "./logger.js";

async function getProjectName(projectId) {
  const { data } = await supabase
    .from("projects")
    .select("name")
    .eq("id", projectId)
    .single();
  return data?.name || projectId;
}

async function getNotificationSettings(projectId) {
  const { data } = await supabase
    .from("notification_settings")
    .select("*")
    .eq("project_id", projectId)
    .single();
  return data;
}

async function getOrganizationOwners(organizationId) {
  const { data } = await supabase
    .from("organizations")
    .select("owner_user_id")
    .eq("id", organizationId)
    .single();
  if (!data) return [];

  const { data: users } = await supabase.auth.admin.listUsers();
  const owner = users?.users?.find((u) => u.id === data.owner_user_id);
  return owner ? [owner.email] : [];
}

const EVALUATORS = {
  latency_spike: async (alert, metrics) => {
    const avgLatency = metrics?.summary?.avg_latency || 0;
    return { triggered: avgLatency > alert.threshold_value, value: avgLatency };
  },
  error_rate_spike: async (alert, metrics) => {
    const total = metrics?.summary?.total_requests || 0;
    const failed = metrics?.summary?.failed_requests || 0;
    const rate = total > 0 ? (failed / total) * 100 : 0;
    return { triggered: rate > alert.threshold_value, value: rate };
  },
  token_burn_spike: async (alert, metrics) => {
    const tokens = metrics?.summary?.total_tokens || 0;
    return { triggered: tokens > alert.threshold_value, value: tokens };
  },
  provider_outage: async (alert, metrics) => {
    const errors = metrics?.errors_by_provider || [];
    const provider = alert.name?.toLowerCase().includes("openai")
      ? "openai"
      : alert.name?.toLowerCase().includes("claude") ||
          alert.name?.toLowerCase().includes("anthropic")
        ? "anthropic"
        : alert.name?.toLowerCase().includes("groq")
          ? "groq"
          : null;
    if (!provider) return { triggered: false, value: 0 };
    const providerErrors = errors.find(
      (e) => e.provider?.toLowerCase() === provider,
    );
    return {
      triggered: (providerErrors?.total || 0) > alert.threshold_value,
      value: providerErrors?.total || 0,
    };
  },
  throughput_drop: async (alert, metrics) => {
    const rps = metrics?.summary?.requests_per_minute || 0;
    return { triggered: rps < alert.threshold_value, value: rps };
  },
};

export async function evaluateAlert(alert) {
  try {
    const metrics = await getMetrics({
      projectId: alert.project_id,
      startDate: new Date(
        Date.now() - alert.time_window_minutes * 60000,
      ).toISOString(),
    });

    if (!metrics) return;

    const evaluator = EVALUATORS[alert.alert_type];
    if (!evaluator) return;

    const { triggered, value } = await evaluator(alert, metrics);
    if (!triggered) return;

    const projectName = await getProjectName(alert.project_id);
    const settings = await getNotificationSettings(alert.project_id);

    await supabase.from("alert_events").insert({
      alert_id: alert.id,
      project_id: alert.project_id,
      triggered_value: value,
      status: "triggered",
    });

    const alertInfo = {
      alertName: alert.name,
      alertType: alert.alert_type,
      triggeredValue: value,
      threshold: alert.threshold_value,
      projectName,
      timestamp: new Date().toISOString(),
    };

    if (
      alert.notification_channel === "email" ||
      alert.notification_channel === "all"
    ) {
      if (settings?.email_enabled !== false) {
        const owners = await getOrganizationOwners(
          (
            await supabase
              .from("projects")
              .select("organization_id")
              .eq("id", alert.project_id)
              .single()
          ).data?.organization_id,
        );
        for (const email of owners) {
          if (email) {
            const mail = buildAlertEmail(alertInfo);
            await sendEmail({ to: email, ...mail });
          }
        }
      }
    }

    if (
      alert.notification_channel === "slack" ||
      alert.notification_channel === "all"
    ) {
      if (settings?.slack_webhook_url) {
        await sendSlackAlert(settings.slack_webhook_url, alertInfo);
      }
    }

    if (
      alert.notification_channel === "webhook" ||
      alert.notification_channel === "all"
    ) {
      if (settings?.webhook_url) {
        await sendWebhookAlert(settings.webhook_url, alertInfo);
      }
    }
  } catch (err) {
    logger.error({ err, alertId: alert.id }, "Alert evaluation error");
  }
}

export async function evaluateAllAlerts() {
  const { data: alerts, error } = await supabase
    .from("alerts")
    .select("*")
    .eq("is_active", true);

  if (error) {
    logger.error({ err: error }, "Failed to fetch alerts");
    return;
  }

  for (const alert of alerts) {
    await evaluateAlert(alert);
  }
}
