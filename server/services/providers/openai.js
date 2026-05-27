import OpenAI from "openai";

export function createOpenAIAdapter(apiKey) {
  const client = new OpenAI({ apiKey });

  return {
    async chat({ messages, model, stream }) {
      const completion = await client.chat.completions.create({
        model: model || "gpt-4o-mini",
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
        model: model || "gpt-4o-mini",
        messages,
        stream: true,
      });

      for await (const chunk of stream) {
        const content = chunk.choices[0]?.delta?.content || "";
        if (content) yield content;
      }
    },

    normalizeError(err) {
      return err.message || "OpenAI API error";
    },
  };
}
