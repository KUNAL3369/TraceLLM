import { Resend } from "resend";

let resendClient = null;
try {
  if (process.env.RESEND_API_KEY) {
    resendClient = new Resend(process.env.RESEND_API_KEY);
  }
} catch (err) {
  process.stderr.write(`Resend not configured: ${err.message}\n`);
}

export async function sendEmail({ to, subject, html }) {
  if (!resendClient) {
    process.stderr.write(
      `Resend not configured — email not sent: ${subject}\n`,
    );
    return { success: false, reason: "Resend not configured" };
  }

  try {
    const { data, error } = await resendClient.emails.send({
      from: process.env.EMAIL_FROM || "TraceLLM <alerts@tracellm.ai>",
      to,
      subject,
      html,
    });
    if (error) throw error;
    return { success: true, id: data?.id };
  } catch (err) {
    process.stderr.write(`Email send error: ${err}\n`);
    return { success: false, error: err.message };
  }
}

export function buildAlertEmail({
  projectName,
  alertName,
  alertType,
  triggeredValue,
  threshold,
  timestamp,
}) {
  return {
    subject: `[TraceLLM Alert] ${alertName} — ${projectName}`,
    html: `
      <div style="font-family: system-ui, sans-serif; max-width: 560px; margin: 0 auto;">
        <div style="background: #1e293b; padding: 24px; border-radius: 12px;">
          <h1 style="color: #ef4444; font-size: 20px; margin: 0 0 16px;">🚨 Alert Triggered</h1>
          <table style="width: 100%; border-collapse: collapse;">
            <tr><td style="padding: 8px 0; color: #94a3b8;">Project</td><td style="padding: 8px 0; color: #fff; font-weight: 600;">${projectName}</td></tr>
            <tr><td style="padding: 8px 0; color: #94a3b8;">Alert</td><td style="padding: 8px 0; color: #fff;">${alertName}</td></tr>
            <tr><td style="padding: 8px 0; color: #94a3b8;">Type</td><td style="padding: 8px 0; color: #fff;">${alertType}</td></tr>
            <tr><td style="padding: 8px 0; color: #94a3b8;">Value</td><td style="padding: 8px 0; color: #ef4444; font-weight: 600;">${triggeredValue} (threshold: ${threshold})</td></tr>
            <tr><td style="padding: 8px 0; color: #94a3b8;">Time</td><td style="padding: 8px 0; color: #fff;">${new Date(timestamp).toLocaleString()}</td></tr>
          </table>
          <a href="${process.env.APP_URL || "http://localhost:5173"}" style="display: inline-block; margin-top: 20px; padding: 10px 20px; background: #3b82f6; color: #fff; text-decoration: none; border-radius: 8px; font-size: 14px;">
            View Dashboard
          </a>
        </div>
      </div>
    `,
  };
}
