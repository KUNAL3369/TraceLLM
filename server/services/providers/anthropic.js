import Anthropic from "@anthropic-ai/sdk";

export function createAnthropicAdapter(apiKey) {
  const client = new Anthropic({ apiKey });

  return {
    async chat({ messages, model, stream }) {
      const systemMsg = messages.find((m) => m.role === "system");
      const userMessages = messages.filter((m) => m.role !== "system");

      const body = {
        model: model || "claude-3-haiku-20240307",
        max_tokens: 4096,
        messages: userMessages.map((m) => ({
          role: m.role === "assistant" ? "assistant" : "user",
          content: m.content,
        })),
        stream: !!stream,
      };
      if (systemMsg) body.system = systemMsg.content;

      if (stream) {
        const response = await client.messages.create(body);
        return response;
      }

      const response = await client.messages.create(body);

      const content = response.content
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("");

      return {
        content,
        usage: {
          prompt_tokens: response.usage?.input_tokens || 0,
          completion_tokens: response.usage?.output_tokens || 0,
          total_tokens: (response.usage?.input_tokens || 0) + (response.usage?.output_tokens || 0),
        },
      };
    },

    async *streamChat({ messages, model }) {
      const userMessages = messages.filter((m) => m.role !== "system");
      const stream = await client.messages.create({
        model: model || "claude-3-haiku-20240307",
        max_tokens: 4096,
        messages: userMessages.map((m) => ({
          role: m.role === "assistant" ? "assistant" : "user",
          content: m.content,
        })),
        stream: true,
      });

      for await (const chunk of stream) {
        if (chunk.type === "content_block_delta" && chunk.delta?.text) {
          yield chunk.delta.text;
        }
      }
    },

    normalizeError(err) {
      return err.message || "Anthropic API error";
    },
  };
}
