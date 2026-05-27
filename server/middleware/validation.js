import { z } from "zod";

export const ingestSchema = z.object({
  project_id: z.string(),
  conversation_id: z.string().optional(),
  session_id: z.string().optional(),
  provider: z.string(),
  model: z.string(),
  latency_ms: z.number().int().nonnegative(),
  prompt_tokens: z.number().int().nonnegative().default(0),
  completion_tokens: z.number().int().nonnegative().default(0),
  total_tokens: z.number().int().nonnegative().default(0),
  status: z.enum(["success", "error"]),
  error_type: z.string().optional(),
  request_preview: z.string().max(500).optional().default(""),
  response_preview: z.string().max(500).optional().default(""),
});

export const chatRequestSchema = z.object({
  messages: z.array(z.object({
    role: z.enum(["user", "assistant", "system"]),
    content: z.string(),
  })).min(1),
  provider: z.string().default("openai"),
  model: z.string().default("gpt-4o-mini"),
  apiKey: z.string().optional(),
  sessionId: z.string().optional(),
  conversationId: z.string().optional(),
  stream: z.boolean().default(false),
});
