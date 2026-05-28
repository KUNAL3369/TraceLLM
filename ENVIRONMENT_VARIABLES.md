# Environment Variables

## Required

| Variable | Description |
|----------|-------------|
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key (server-side, has full access) |
| `VITE_SUPABASE_URL` | Supabase URL exposed to frontend |
| `VITE_SUPABASE_ANON_KEY` | Supabase anon key (frontend-safe) |

## Frontend

| Variable | Default | Description |
|----------|---------|-------------|
| `VITE_API_URL` | `http://localhost:3001` | Backend API URL |
| `VITE_FRONTEND_URL` | `http://localhost:5173` | Frontend URL (for CORS) |

## LLM Providers

At least one required for chat functionality:

| Variable | Description |
|----------|-------------|
| `OPENAI_API_KEY` | OpenAI API key |
| `ANTHROPIC_API_KEY` | Anthropic API key |
| `GROQ_API_KEY` | Groq API key |
| `OPENROUTER_API_KEY` | OpenRouter API key |
| `OPENROUTER_BASE_URL` | OpenRouter base URL (default: `https://openrouter.ai/api/v1`) |

## Notifications (optional)

| Variable | Description |
|----------|-------------|
| `RESEND_API_KEY` | Resend.com API key for email alerts |
| `EMAIL_FROM` | From address for alert emails |
| `APP_URL` | Public app URL (used in email/webhook payloads) |
| `SLACK_WEBHOOK_URL` | Slack webhook URL for alerts |

## Redis / Queue (optional)

| Variable | Default | Description |
|----------|---------|-------------|
| `REDIS_URL` | — | Redis connection string. If unset, ingestion falls back to direct DB writes. |

## Observability (optional)

| Variable | Description |
|----------|-------------|
| `OTEL_ENABLED` | Enables OpenTelemetry instrumentation |
| `LOG_LEVEL` | Pino log level (default: `debug` in dev, `info` in prod) |
| `NODE_ENV` | Set to `production` for production optimizations |
| `PORT` | Server port (default: `3001`) |
