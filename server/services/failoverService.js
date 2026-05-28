import { logger } from "./logger.js";

/**
 * Provider failover logic.
 * If the primary provider fails, try fallback providers in order.
 */
const providerClientMap = {};

async function lazyInitProvider(name) {
  if (providerClientMap[name]) return providerClientMap[name];
  switch (name) {
    case "openai": {
      const { default: OpenAI } = await import("openai");
      if (process.env.OPENAI_API_KEY) {
        providerClientMap[name] = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
      }
      break;
    }
    case "anthropic": {
      const { default: Anthropic } = await import("@anthropic-ai/sdk");
      if (process.env.ANTHROPIC_API_KEY) {
        providerClientMap[name] = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
      }
      break;
    }
    case "groq": {
      const { default: Groq } = await import("groq-sdk");
      if (process.env.GROQ_API_KEY) {
        providerClientMap[name] = new Groq({ apiKey: process.env.GROQ_API_KEY });
      }
      break;
    }
    case "openrouter": {
      const { default: OpenAI } = await import("openai");
      if (process.env.OPENROUTER_API_KEY) {
        providerClientMap[name] = new OpenAI({
          apiKey: process.env.OPENROUTER_API_KEY,
          baseURL: process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1",
        });
      }
      break;
    }
  }
  return providerClientMap[name];
}

export async function executeWithFailover({
  primaryProvider,
  fallbackProviders = [],
  execute,
}) {
  const providers = [primaryProvider, ...fallbackProviders];
  let lastError = null;

  for (const provider of providers) {
    try {
      const client = await lazyInitProvider(provider);
      if (!client) {
        logger.warn({ provider }, "Failover: provider not configured, skipping");
        continue;
      }
      const result = await execute(provider, client);
      return { provider, result };
    } catch (err) {
      logger.warn({ err, provider }, "Failover: provider failed, trying next");
      lastError = err;
    }
  }

  throw lastError || new Error("All providers exhausted");
}

export async function getFailoverConfig(projectId) {
  const { supabase } = await import("../db/supabase.js");
  const { data } = await supabase
    .from("provider_failover")
    .select("*")
    .eq("project_id", projectId)
    .eq("enabled", true);
  return data || [];
}
