import { supabase } from "../db/supabase.js";
import { logger } from "./logger.js";

export async function logAudit({
  userId,
  projectId,
  action,
  metadata = {},
  ipAddress,
  requestId,
  apiKeyId,
}) {
  try {
    await supabase.from("audit_logs").insert({
      user_id: userId,
      project_id: projectId,
      action,
      metadata: {
        ...metadata,
        ...(requestId ? { request_id: requestId } : {}),
        ...(apiKeyId ? { api_key_id: apiKeyId } : {}),
      },
      ip_address: ipAddress || null,
    });
  } catch (err) {
    logger.error({ err }, "Audit log error");
  }
}
