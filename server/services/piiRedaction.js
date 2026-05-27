const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const PHONE_REGEX = /\+?1?\d{10,15}/g;
const CC_REGEX = /\b(?:\d[ -]*?){13,16}\b/g;
const API_KEY_REGEX = /(?:sk-|tracellm_|api_key|apikey)[\w-]{8,}/gi;
const BEARER_TOKEN_REGEX = /Bearer\s+[\w-]+\.[\w-]+\.[\w-]+/g;
const PASSWORD_REGEX = /password[=:]["']?([^"'&\s]+)["']?/gi;
const JWT_REGEX = /eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/g;

export function redactPII(text) {
  if (!text) return text;
  return text
    .replace(EMAIL_REGEX, "[REDACTED_EMAIL]")
    .replace(PHONE_REGEX, "[REDACTED_PHONE]")
    .replace(CC_REGEX, "[REDACTED_CC]")
    .replace(API_KEY_REGEX, "[REDACTED_API_KEY]")
    .replace(BEARER_TOKEN_REGEX, "Bearer [REDACTED_TOKEN]")
    .replace(PASSWORD_REGEX, "password=[REDACTED]")
    .replace(JWT_REGEX, "[REDACTED_JWT]");
}

export function redactLogPayload(payload) {
  return {
    ...payload,
    request_preview: payload.request_preview ? redactPII(payload.request_preview) : payload.request_preview,
    response_preview: payload.response_preview ? redactPII(payload.response_preview) : payload.response_preview,
  };
}
