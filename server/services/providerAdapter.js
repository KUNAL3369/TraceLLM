import { createOpenAIAdapter } from "./providers/openai.js";
import { createAnthropicAdapter } from "./providers/anthropic.js";
import { createGroqAdapter } from "./providers/groq.js";
import { createOpenRouterAdapter } from "./providers/openrouter.js";

const adapterFactories = {
  openai: createOpenAIAdapter,
  anthropic: createAnthropicAdapter,
  claude: createAnthropicAdapter,
  groq: createGroqAdapter,
  openrouter: createOpenRouterAdapter,
};

export function getProviderAdapter(provider, apiKey) {
  const factory = adapterFactories[provider?.toLowerCase()];
  if (!factory) {
    throw new Error(`Unsupported provider: ${provider}. Supported: ${Object.keys(adapterFactories).join(", ")}`);
  }
  return factory(apiKey);
}

export function getDefaultModel(provider) {
  const models = {
    openai: "gpt-4o-mini",
    anthropic: "claude-3-haiku-20240307",
    claude: "claude-3-haiku-20240307",
    groq: "llama-3.3-70b-versatile",
    openrouter: "meta-llama/llama-3.3-70b-instruct:free",
  };
  return models[provider?.toLowerCase()] || "gpt-4o-mini";
}

export const PROVIDER_LIST = [
  { id: "openai", name: "OpenAI", models: ["gpt-4o-mini", "gpt-4o", "gpt-4-turbo"] },
  { id: "anthropic", name: "Anthropic", models: ["claude-3-haiku-20240307", "claude-3-sonnet-20240229", "claude-3-opus-20240229"] },
  { id: "groq", name: "Groq", models: ["llama-3.3-70b-versatile", "llama-3.1-8b-instant", "deepseek-r1-distill-llama-70b"] },
  { id: "openrouter", name: "OpenRouter", models: ["meta-llama/llama-3.3-70b-instruct:free", "openai/gpt-oss-20b:free", "openai/gpt-oss-120b:free", "nvidia/nemotron-nano-9b-v2:free", "qwen/qwen3-coder:free"] },
];
