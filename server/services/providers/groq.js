import Groq from "groq-sdk";

export function createGroqAdapter(apiKey) {
  const client = new Groq({ apiKey });

  return {
    async chat({ messages, model, stream }) {
      const completion = await client.chat.completions.create({
        model: model || "llama3-70b-8192",
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
        model: model || "llama3-70b-8192",
        messages,
        stream: true,
      });

      for await (const chunk of stream) {
        const content = chunk.choices[0]?.delta?.content || "";
        if (content) yield content;
      }
    },

    normalizeError(err) {
      return err.message || "Groq API error";
    },
  };
}
