import OpenAI from "openai";

const OPENROUTER_BASE_URL = process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1";
const APP_URL = process.env.APP_URL || "http://localhost:5173";

export function createOpenRouterAdapter(apiKey) {
  const client = new OpenAI({
    apiKey: apiKey || process.env.OPENROUTER_API_KEY,
    baseURL: OPENROUTER_BASE_URL,
    defaultHeaders: {
      "HTTP-Referer": APP_URL,
      "X-Title": "TraceLLM",
    },
  });

  return {
    async chat({ messages, model, stream }) {
      const completion = await client.chat.completions.create({
        model: model || "meta-llama/llama-3.3-70b-instruct:free",
        messages,
        stream: !!stream,
      });

      if (stream) return completion;

      return {
        content: completion.choices[0]?.message?.content || "",
        usage: {
          prompt_tokens: completion.usage?.prompt_tokens || 0,
          completion_tokens: completion.usage?.completion_tokens || 0,
          total_tokens: completion.usage?.total_tokens || 0,
        },
      };
    },

    async *streamChat({ messages, model }) {
      const stream = await client.chat.completions.create({
        model: model || "meta-llama/llama-3.3-70b-instruct:free",
        messages,
        stream: true,
      });

      for await (const chunk of stream) {
        const content = chunk.choices[0]?.delta?.content || "";
        if (content) yield content;
      }
    },

    normalizeError(err) {
      if (err?.status === 402) return "OpenRouter: insufficient credits or model requires paid plan";
      if (err?.status === 429) return "OpenRouter: rate limited. Try a different model or wait.";
      return err.message || "OpenRouter API error";
    },
  };
}
