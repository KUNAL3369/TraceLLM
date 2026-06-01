import { Router } from "express";
import {
  getProviderAdapter,
  getDefaultModel,
} from "../services/providerAdapter.js";
import { supabase } from "../db/supabase.js";
import { trackUsage } from "../services/usageService.js";
import { logAudit } from "../services/auditService.js";
import { logger } from "../services/logger.js";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isValidUUID(val) {
  return typeof val === "string" && UUID_RE.test(val);
}

const router = Router();

function getProjectId(req) {
  const id = req.body.project_id || req.projectId || null;
  if (id && !isValidUUID(id)) return null;
  return id;
}

async function persistInferenceLog({
  projectId,
  provider,
  model,
  latency,
  promptTokens,
  completionTokens,
  totalTokens,
  status,
  errorType,
  requestPreview,
  responsePreview,
  sessionId,
  conversationId,
  userId,
}) {
  try {
    if (!projectId || !isValidUUID(projectId)) {
      logger.warn({ projectId }, "Skipping persist — invalid project_id");
      return null;
    }

    const payload = {
      project_id: projectId,
      conversation_id:
        conversationId && isValidUUID(conversationId) ? conversationId : null,
      session_id: sessionId || null,
      provider,
      model,
      latency_ms: latency,
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: totalTokens,
      status,
      error_type: errorType || null,
      request_preview: (requestPreview || "").slice(0, 500),
      response_preview: (responsePreview || "").slice(0, 500),
    };

    logger.info(
      {
        project_id: projectId,
        conversation_id: payload.conversation_id,
        user_id: userId,
        status,
      },
      "Persisting inference log from chat route",
    );

    const { data, error } = await supabase
      .from("inference_logs")
      .insert(payload)
      .select()
      .single();

    if (error) {
      logger.error({ err: error }, "Chat persist inference_log error");
      return null;
    }

    await trackUsage({
      projectId,
      tokenCount: totalTokens,
    });

    if (userId) {
      await logAudit({
        userId,
        projectId,
        action: "chat.completion",
        metadata: {
          provider,
          model,
          tokens: totalTokens,
          conversation_id: conversationId,
          session_id: sessionId,
        },
      }).catch(() => {});
    }

    return data;
  } catch (err) {
    logger.error({ err }, "Chat persist error");
    return null;
  }
}

router.post("/", async (req, res) => {
  const startTime = Date.now();
  try {
    const {
      messages,
      provider = "openai",
      model,
      apiKey,
      stream,
      sessionId,
      conversationId,
    } = req.body;

    if (!messages || !messages.length) {
      return res.status(400).json({ error: "Messages are required" });
    }

    const projectId = getProjectId(req);
    const userId = req.userId;
    const requestPreview = (messages[messages.length - 1]?.content || "").slice(
      0,
      500,
    );

    const userApiKey =
      apiKey ||
      process.env[`${provider.toUpperCase()}_API_KEY`] ||
      process.env.OPENAI_API_KEY;

    if (!userApiKey) {
      return simulateChat(req, res);
    }

    const adapter = getProviderAdapter(provider, userApiKey);
    const resolvedModel = model || getDefaultModel(provider);

    if (stream) {
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");

      let fullContent = "";
      let streamError = null;

      try {
        const streamIter = adapter.streamChat({
          messages,
          model: resolvedModel,
        });
        for await (const content of streamIter) {
          if (content) {
            fullContent += content;
            res.write(
              `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`,
            );
          }
        }
      } catch (streamErr) {
        streamError = streamErr;
        const errorMsg =
          adapter.normalizeError?.(streamErr) || streamErr.message;
        res.write(`data: ${JSON.stringify({ error: errorMsg })}\n\n`);
      }

      res.write("data: [DONE]\n\n");
      res.end();

      const latency = Date.now() - startTime;
      const isError = !!streamError;
      persistInferenceLog({
        projectId,
        provider,
        model: resolvedModel,
        latency,
        promptTokens: 0,
        completionTokens: isError ? 0 : fullContent.length,
        totalTokens: 0,
        status: isError ? "error" : "success",
        errorType: streamError
          ? adapter.normalizeError?.(streamError) || streamError.message
          : null,
        requestPreview,
        responsePreview: isError ? "" : fullContent.slice(0, 500),
        sessionId,
        conversationId,
        userId,
      });
    } else {
      const result = await adapter.chat({
        messages,
        model: resolvedModel,
        stream: false,
      });

      const latency = Date.now() - startTime;
      const responseContent = result.content || "";
      const usage = result.usage || {
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0,
      };

      persistInferenceLog({
        projectId,
        provider,
        model: resolvedModel,
        latency,
        promptTokens: usage.prompt_tokens,
        completionTokens: usage.completion_tokens,
        totalTokens: usage.total_tokens,
        status: "success",
        requestPreview,
        responsePreview: responseContent.slice(0, 500),
        sessionId,
        conversationId,
        userId,
      });

      return res.json({
        content: responseContent,
        usage,
      });
    }
  } catch (err) {
    logger.error({ err }, "Chat error");
    if (!res.headersSent) {
      return res.status(500).json({ error: err.message || "Chat failed" });
    }
  }
});

function simulateChat(req, res) {
  const { messages, stream, sessionId, conversationId } = req.body;
  const startTime = Date.now();
  const lastMsg = messages[messages.length - 1]?.content || "";
  const responses = [
    "Running in simulation mode. Configure a provider API key (OPENAI_API_KEY, ANTHROPIC_API_KEY, or GROQ_API_KEY) in your .env file.",
    `You said: "${lastMsg.slice(0, 50)}". Set up an API key for live LLM inference with observability.`,
    "TraceLLM is monitoring this conversation. Telemetry is captured for your dashboard even in simulation mode.",
    "Demo response — configure a provider to test real multi-provider routing with full observability.",
    "LLM inference monitoring active. Your logs are being tracked for latency, tokens, and errors.",
  ];
  const content = responses[Math.floor(Math.random() * responses.length)];
  const projectId = getProjectId(req);

  if (stream) {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    for (const char of content) {
      res.write(
        `data: ${JSON.stringify({ choices: [{ delta: { content: char } }] })}\n\n`,
      );
    }
    res.write("data: [DONE]\n\n");
    res.end();

    persistInferenceLog({
      projectId,
      provider: "simulation",
      model: "simulation",
      latency: Date.now() - startTime,
      promptTokens: 0,
      completionTokens: content.length,
      totalTokens: 0,
      status: "success",
      requestPreview: lastMsg.slice(0, 500),
      responsePreview: content.slice(0, 500),
      sessionId,
      conversationId,
      userId: req.userId,
    });
  } else {
    persistInferenceLog({
      projectId,
      provider: "simulation",
      model: "simulation",
      latency: Date.now() - startTime,
      promptTokens: 0,
      completionTokens: content.length,
      totalTokens: 0,
      status: "success",
      requestPreview: lastMsg.slice(0, 500),
      responsePreview: content.slice(0, 500),
      sessionId,
      conversationId,
      userId: req.userId,
    });

    return res.json({
      content,
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    });
  }
}

export default router;
