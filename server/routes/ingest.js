import { Router } from "express";
import { supabase } from "../db/supabase.js";
import { ingestSchema } from "../middleware/validation.js";
import { z } from "zod";
import { redactLogPayload } from "../services/piiRedaction.js";
import { trackUsage, checkUsageLimit } from "../services/usageService.js";
import { enqueueIngest } from "../services/queueService.js";
import { logger } from "../services/logger.js";
import { trackTokens } from "../routes/internal.js";

const router = Router();

router.post("/", async (req, res) => {
  const startTime = Date.now();
  try {
    const parsed = ingestSchema.parse({
      ...req.body,
      project_id: req.body.project_id || req.projectId,
    });

    const { allowed, reason, plan } = await checkUsageLimit(parsed.project_id);
    if (!allowed) {
      return res.status(429).json({ error: reason, plan });
    }

    const payload = {
      project_id: parsed.project_id,
      conversation_id: parsed.conversation_id || null,
      session_id: parsed.session_id || null,
      provider: parsed.provider,
      model: parsed.model,
      latency_ms: parsed.latency_ms,
      prompt_tokens: parsed.prompt_tokens,
      completion_tokens: parsed.completion_tokens,
      total_tokens: parsed.total_tokens,
      status: parsed.status,
      error_type: parsed.error_type || null,
      request_preview: parsed.request_preview,
      response_preview: parsed.response_preview,
    };

    trackTokens(parsed.total_tokens);

    const jobId = await enqueueIngest(payload);

    if (jobId) {
      return res.status(202).json({ success: true, queued: true, job_id: jobId });
    }

    req.startDBTimer?.();
    const { data: project } = await supabase
      .from("projects")
      .select("pii_redaction_enabled")
      .eq("id", parsed.project_id)
      .single();
    req.endDBTimer?.();

    const finalPayload = project?.pii_redaction_enabled ? redactLogPayload(payload) : payload;

    req.startDBTimer?.();
    const { data, error } = await supabase.from("inference_logs").insert(finalPayload).select().single();
    req.endDBTimer?.();

    if (error) {
      logger.error({ err: error, projectId: parsed.project_id }, "Ingest DB error");
      return res.status(500).json({ error: "Failed to store log" });
    }

    await trackUsage({
      projectId: parsed.project_id,
      tokenCount: parsed.total_tokens,
    });

    const duration = Date.now() - startTime;
    logger.info({
      type: "ingest",
      projectId: parsed.project_id,
      provider: parsed.provider,
      status: parsed.status,
      duration_ms: duration,
      tokens: parsed.total_tokens,
    }, "Ingest processed");

    return res.status(201).json({ success: true, id: data.id });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: "Validation failed", details: err.errors });
    }
    logger.error({ err }, "Ingest error");
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
