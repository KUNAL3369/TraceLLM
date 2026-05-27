import { Router } from "express";
import { getProviderAdapter, getDefaultModel } from "../services/providerAdapter.js";

const router = Router();

router.post("/", async (req, res) => {
  try {
    const { messages, provider = "openai", model, apiKey, stream } = req.body;

    if (!messages || !messages.length) {
      return res.status(400).json({ error: "Messages are required" });
    }

    const userApiKey = apiKey || process.env[`${provider.toUpperCase()}_API_KEY`] || process.env.OPENAI_API_KEY;

    if (!userApiKey) {
      return simulateChat(req, res);
    }

    const adapter = getProviderAdapter(provider, userApiKey);
    const resolvedModel = model || getDefaultModel(provider);

    if (stream) {
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");

      try {
        const streamIter = adapter.streamChat({ messages, model: resolvedModel });
        for await (const content of streamIter) {
          if (content) {
            res.write(`data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`);
          }
        }
      } catch (streamErr) {
        const errorMsg = adapter.normalizeError?.(streamErr) || streamErr.message;
        res.write(`data: ${JSON.stringify({ error: errorMsg })}\n\n`);
      }
      res.write("data: [DONE]\n\n");
      res.end();
    } else {
      const result = await adapter.chat({ messages, model: resolvedModel, stream: false });
      return res.json({
        content: result.content,
        usage: result.usage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      });
    }
  } catch (err) {
    console.error("Chat error:", err);
    if (!res.headersSent) {
      return res.status(500).json({ error: err.message || "Chat failed" });
    }
  }
});

function simulateChat(req, res) {
  const { messages, stream } = req.body;
  const lastMsg = messages[messages.length - 1]?.content || "";
  const responses = [
    "Running in simulation mode. Configure a provider API key (OPENAI_API_KEY, ANTHROPIC_API_KEY, or GROQ_API_KEY) in your .env file.",
    `You said: "${lastMsg.slice(0, 50)}". Set up an API key for live LLM inference with observability.`,
    "TraceLLM is monitoring this conversation. Telemetry is captured for your dashboard even in simulation mode.",
    "Demo response — configure a provider to test real multi-provider routing with full observability.",
    "LLM inference monitoring active. Your logs are being tracked for latency, tokens, and errors.",
  ];
  const content = responses[Math.floor(Math.random() * responses.length)];

  if (stream) {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    for (const char of content) {
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: char } }] })}\n\n`);
    }
    res.write("data: [DONE]\n\n");
    res.end();
  } else {
    return res.json({
      content,
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    });
  }
}

export default router;
