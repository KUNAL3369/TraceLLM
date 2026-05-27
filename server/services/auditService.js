import { supabase } from "../db/supabase.js";

export async function logAudit({ userId, projectId, action, metadata = {} }) {
  try {
    await supabase.from("audit_logs").insert({
      user_id: userId,
      project_id: projectId,
      action,
      metadata,
    });
  } catch (err) {
    console.error("Audit log error:", err);
  }
}
