<div align="center">

# TraceLLM

**LLM Inference Observability Platform — monitor, log, and alert on every LLM call across multiple providers.**

[![React](https://img.shields.io/badge/React_19-61DAFB?logo=react&logoColor=black)](https://reactjs.org/)
[![Express](https://img.shields.io/badge/Express_5-000?logo=express&logoColor=white)](https://expressjs.com/)
[![Supabase](https://img.shields.io/badge/Supabase-3ECF8E?logo=supabase&logoColor=black)](https://supabase.com/)
[![TailwindCSS](https://img.shields.io/badge/Tailwind_CSS-38B2AC?logo=tailwind-css&logoColor=black)](https://tailwindcss.com/)
[![Vite](https://img.shields.io/badge/Vite-646CFF?logo=vite&logoColor=white)](https://vitejs.dev/)
[![BullMQ](https://img.shields.io/badge/BullMQ-FE2C55?logo=redis&logoColor=white)](https://bullmq.io/)

</div>

---

## Features

| Feature | Description |
|---------|-------------|
| **Multi-Provider Chat** | Chat with OpenAI, Anthropic, Groq, or OpenRouter — switch providers mid-conversation |
| **Streaming Responses** | SSE-based streaming with cancel support |
| **Inference Logging** | Every LLM call is logged with latency, tokens, provider, model, status, and I/O previews |
| **Latency & Throughput Dashboards** | P95 latency, requests/min, provider distribution, token usage trends |
| **Error Analytics** | Error breakdown by provider, error type distribution |
| **Alerting** | 5 alert types (latency spike, error rate spike, token burn, provider outage, throughput drop) with email / Slack / webhook delivery |
| **PII Redaction** | Auto-redact emails, phones, credit cards, API keys, tokens, passwords from logged previews |
| **Rate Limiting & Usage Tracking** | Per-project monthly limits with 429 enforcement |
| **Audit Logs** | Track all configuration changes per project |
| **Tenant Isolation** | Row-Level Security scopes all data by organization ownership |
| **API Key Auth** | SHA-256 hashed API keys for SDK ingestion |

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Frontend (React + Vite)                  │
│  ┌─────────┐  ┌──────────┐  ┌──────────┐  ┌────────────────┐  │
│  │ Chat UI │  │Dashboard │  │  Alerts  │  │  SDK (sdk.js)  │  │
│  │  Chat   │  │ Metrics  │  │  Billing │  │  chatCompletion│  │
│  │  .jsx   │  │ .jsx     │  │  Audit   │  │  + ingestLog() │  │
│  └────┬────┘  └────┬─────┘  └────┬─────┘  └───────┬────────┘  │
│       │            │              │                 │          │
└───────┼────────────┼──────────────┼─────────────────┼──────────┘
        │            │              │                 │
        ▼            ▼              ▼                 ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Express API (server/index.js)                 │
│                                                                  │
│  ┌───────────┐  ┌──────────┐  ┌────────────┐  ┌───────────┐    │
│  │ POST      │  │ GET      │  │ CRUD       │  │ GET       │    │
│  │ /api/chat │  │ /api     │  │ /api       │  │ /api      │    │
│  │           │  │ /metrics │  │ /alerts    │  │ /billing  │    │
│  └─────┬─────┘  └────┬─────┘  └─────┬──────┘  └────┬──────┘    │
│        │              │              │              │           │
│        ▼              ▼              ▼              ▼           │
│  ┌──────────┐  ┌────────────┐  ┌──────────┐  ┌──────────┐     │
│  │Provider  │  │Telemetry   │  │Alert     │  │Usage     │     │
│  │Adapter   │  │Ingestion   │  │Evaluator │  │Tracker   │     │
│  │Factory   │  │(BullMQ)    │  │(cron)    │  │          │     │
│  └────┬─────┘  └─────┬──────┘  └──────────┘  └──────────┘     │
│       │               │                                         │
└───────┼───────────────┼─────────────────────────────────────────┘
        │               │
        ▼               ▼
┌──────────────┐  ┌──────────────┐
│  Provider    │  │  Supabase    │
│  APIs        │  │  PostgreSQL  │
│  (OpenAI,    │  │  + RLS       │
│  Anthropic,  │  │              │
│  Groq,       │  │  12 tables   │
│  OpenRouter) │  │  28 indexes  │
└──────────────┘  └──────────────┘
```

### Ingestion Flow

```
SDK (chatCompletion)                  Express API                     Supabase
       │                                    │                          │
       │  POST /api/ingest                  │                          │
       ├───────────────────────────────────►│                          │
       │                                    │                          │
       │                              ┌─────▼──────┐                   │
       │                              │  Zod       │                   │
       │                              │  Validate  │                   │
       │                              └─────┬──────┘                   │
       │                                    │                          │
       │                              ┌─────▼──────┐                   │
       │                              │  API Key   │                   │
       │                              │  Auth      │                   │
       │                              └─────┬──────┘                   │
       │                                    │                          │
       │                              ┌─────▼──────┐                   │
       │                              │  Usage     │                   │
       │                              │  Limit     │──► 429 if over   │
       │                              └─────┬──────┘                   │
       │                                    │                          │
       │                          ┌─────────▼──────────┐               │
       │                          │  Redis Available?   │              │
       │                          └────┬────────────┬───┘              │
       │                               │ Yes        │ No               │
       │                               ▼            ▼                  │
       │                         ┌──────────┐  ┌─────────┐            │
       │                         │ BullMQ   │  │ Direct  │            │
       │                         │ Queue    │  │ Insert  │            │
       │                         │ (async)  │  │ (sync)  │            │
       │                         └────┬─────┘  └────┬────┘            │
       │                              │             │                 │
       │                              │             │                 ▼
       │                              │             │          ┌──────────┐
       │                              │             └─────────►│ inference │
       │                              │                       │ _logs    │
       │                              │                       └──────────┘
       │                              ▼
       │                        ┌──────────┐
       │                        │ Worker   │
       │                        │ (PII     │
       │                        │  Redact) │
       │                        └────┬─────┘
       │                             │
       │                             ▼
       │                       ┌──────────┐
       │                       │ inference│
       │                       │ _logs    │
       │                       └──────────┘
```

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19, Vite, Tailwind CSS, Zustand, Recharts, React Router v7 |
| Backend | Express 5, BullMQ, node-cron |
| Database | Supabase (PostgreSQL) with Row-Level Security |
| LLM Providers | OpenAI, Anthropic, Groq, OpenRouter |
| Auth | Supabase Auth (JWT) + SHA-256 API keys |
| Queues | BullMQ + Redis (optional, fallback to direct writes) |
| Notifications | Resend (email), Slack webhooks, generic webhooks |
| Validation | Zod |

---

## Setup

### Prerequisites

- Node.js 18+
- Supabase account (free tier)
- Redis (optional — for queue-based ingestion)
- API keys for desired LLM providers

### 1. Clone and install

```bash
git clone https://github.com/KUNAL3369/Frontend-Observability-Dashboard.git
cd Frontend-Observability-Dashboard
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

**Security note**: The `.env` file is gitignored. Never commit real secrets to the repository. Fill in your own credentials from Supabase and your LLM provider accounts.

Fill in `.env`:

```env
# Supabase (required)
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# LLM Providers (at least one)
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
GROQ_API_KEY=gsk_...
OPENROUTER_API_KEY=sk-or-...

# Notifications (optional, for alerts)
RESEND_API_KEY=re_...
EMAIL_FROM=alerts@yourdomain.com
APP_URL=http://localhost:5173
```

Get your Supabase credentials from **Project Settings > API**.

### 3. Database

1. Go to your Supabase **SQL Editor**
2. Run `server/db/schema.sql`
3. Run `server/db/migration_v2.sql`

This creates 12 tables with indexes, RLS policies, and auto-provisioning triggers.

### 4. Start the app

```bash
# Terminal 1 — backend
npm run dev:server

# Terminal 2 — frontend
npm run dev

# Or both at once
npm run dev:all
```

Open [http://localhost:5173](http://localhost:5173) — sign up or use the demo credentials.

### 5. Docker (optional)

One-command setup with Redis-backed queue ingestion:

```bash
docker compose up --build
```

This starts:
- **Redis** on port 6379
- **Backend** (Express + BullMQ) on port 3001
- **Frontend** (Nginx + built assets) on port 5173

Supabase remains external — set your credentials in `.env` before starting.

---

## Database Schema

### Tables

| Table | Purpose |
|-------|---------|
| `organizations` | Tenant root — each user gets one on signup |
| `projects` | Logical grouping within an organization (dev/staging/prod) |
| `api_keys` | SHA-256 hashed keys scoped to projects |
| `conversations` | Chat sessions with provider/model metadata |
| `messages` | Individual turns within a conversation |
| `inference_logs` | Core telemetry — every LLM call logged here |
| `alerts` | Threshold-based alert rule definitions |
| `alert_events` | Triggered/resolved alert instances |
| `notification_settings` | Per-project Slack/webhook/email config |
| `subscriptions` | Plan limits per organization (free/pro/growth) |
| `usage_tracking` | Monthly usage counters per project |
| `audit_logs` | Configuration change history |

### Schema Design Decisions

- **Denormalized `project_id` on `inference_logs`**: Enables direct indexing and filtering without joining through conversations. The redundancy is justified by query volume — dashboard queries hit this table constantly.
- **`content_preview` over full content**: Messages and logs store truncated previews (first 500 chars). Full content can be reconstructed from the provider's chat history if needed. This reduces storage and limits PII exposure.
- **`key_hash` over raw keys**: API keys are SHA-256 hashed before storage. The raw key is returned once at creation and never stored. A hash lookup authenticates every ingest request.
- **JSONB for `audit_logs.metadata`**: Different actions have different metadata shapes. JSONB avoids table proliferation while keeping queryable structure.
- **Separate `alerts` and `alert_events`**: Rules are static definitions; events are time-series instances. This split allows historical analysis without rule changes.
- **RLS on every table**: Every policy chains through `organizations.owner_user_id` to ensure cross-tenant isolation at the database level.

### Indexing Strategy

28 indexes across all tables. The composite index `(project_id, created_at DESC)` on `inference_logs` covers the most common dashboard query pattern. Individual indexes on `status`, `provider`, `model`, `error_type`, and `latency_ms` support filter-based queries.

---

## API Reference

### Chat

**POST /api/chat** — Send a message to any provider. Supports streaming via SSE.

```
Request (non-streaming):
{
  "messages": [{ "role": "user", "content": "Hello" }],
  "provider": "openrouter",
  "model": "meta-llama/llama-3.3-70b-instruct:free",
  "stream": false
}

Response (200):
{
  "content": "Hi! How can I help you today?",
  "usage": { "prompt_tokens": 12, "completion_tokens": 8, "total_tokens": 20 }
}
```

For streaming: set `"stream": true`. Response is SSE:

```
data: {"choices": [{"delta": {"content": "Hi"}}]}
data: {"choices": [{"delta": {"content": "!"}}]}
data: [DONE]
```

---

### Ingestion

**POST /api/ingest** — Submit an inference log. Requires API key auth.

```
Request:
Authorization: Bearer <api_key>

{
  "project_id": "uuid",
  "provider": "openai",
  "model": "gpt-4o-mini",
  "latency_ms": 1247,
  "prompt_tokens": 45,
  "completion_tokens": 120,
  "total_tokens": 165,
  "status": "success",
  "request_preview": "What is the capital of...",
  "response_preview": "The capital of France is...",
  "session_id": "session_1712345678",
  "conversation_id": "abc-123-def"
}

Response (201 direct):
{ "success": true, "id": "log-uuid" }

Response (202 queued):
{ "success": true, "queued": true, "job_id": "bullmq-job-id" }
```

---

### Metrics

**GET /api/metrics?project_id=<id>** — Aggregate metrics for dashboards.

```
Response (200):
{
  "total_requests": 1520,
  "successful": 1480,
  "failed": 40,
  "avg_latency_ms": 845,
  "p95_latency_ms": 2100,
  "total_prompt_tokens": 28500,
  "total_completion_tokens": 52000,
  "total_tokens": 80500,
  "estimated_cost": 0.42,
  "requests_per_min": 23.4,
  "active_sessions": 3,
  "success_rate": 97.4,
  "provider_breakdown": [
    { "provider": "openai", "count": 800 },
    { "provider": "anthropic", "count": 400 },
    { "provider": "groq", "count": 320 }
  ],
  "recent_requests": [...]
}
```

---

### Conversations

**GET /api/conversations?project_id=<id>** — List conversations.

```
Response (200):
[
  {
    "id": "conv-uuid",
    "project_id": "proj-uuid",
    "session_id": "session_123",
    "user_identifier": null,
    "status": "active",
    "started_at": "2025-05-27T12:00:00Z",
    "last_activity_at": "2025-05-27T12:05:00Z",
    "messages": [{ "count": 4 }]
  }
]
```

**POST /api/conversations** — Create a conversation.

```
Request:
{
  "project_id": "proj-uuid",
  "session_id": "session_123"
}

Response (201):
{ "id": "conv-uuid", "project_id": "proj-uuid", ... }
```

**GET /api/conversations/:id** — Get conversation with messages.

```
Response (200):
{
  "id": "conv-uuid",
  "messages": [
    { "role": "user", "content_preview": "Hello", "created_at": "..." },
    { "role": "assistant", "content_preview": "Hi!", "created_at": "..." }
  ]
}
```

**POST /api/conversations/:id/messages** — Add a message to a conversation.

```
Request:
{
  "role": "user",
  "content": "Hello",
  "token_count": 5
}

Response (201):
{ "id": "msg-uuid", "role": "user", ... }
```

---

### All Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/ingest` | API key | Submit inference log |
| POST | `/api/chat` | Session | Chat with any provider |
| GET | `/api/metrics` | Session | Aggregate metrics |
| GET | `/api/provider-health` | None | Provider status + latency |
| GET | `/api/conversations` | Session | List conversations |
| POST | `/api/conversations` | Session | Create conversation |
| GET | `/api/conversations/:id` | Session | Conversation with messages |
| POST | `/api/conversations/:id/messages` | Session | Add message |
| CRUD | `/api/projects` | Session | Project management |
| CRUD | `/api/alerts` | Session | Alert rules |
| GET | `/api/alerts/events` | Session | Alert events |
| GET/PUT | `/api/billing` | Session | Subscription + usage |
| POST | `/api/billing/upgrade` | Session | Plan change |
| GET | `/api/audit` | Session | Audit logs |
| GET/PUT | `/api/notifications` | Session | Notification settings |

---

## Tradeoffs

| Decision | Tradeoff |
|----------|----------|
| **Client-side SDK** | Simpler integration for developers, but logs can be lost if the client disconnects before the fire-and-forget POST completes. A server-side SDK would be more reliable but requires more setup. |
| **Regex PII redaction** | Fast, no dependencies, covers common patterns. But regex cannot catch all PII forms — context-aware redaction requires ML-based NER. |
| **Direct DB writes (no Redis)** | Zero infrastructure overhead for simple deployments. But synchronous writes block the request and don't survive process restarts. The BullMQ queue is available when Redis is configured. |
| **Node-cron for alerts** | Simple, no external dependency. But cron doesn't scale horizontally — each instance fires independently. For multi-instance deployment, a distributed scheduler (or BullMQ repeatable jobs) would be needed. |
| **Supabase RLS** | Strong tenant isolation without application-layer code. But RLS policies add query overhead, and complex policies can be hard to debug. |
| **Streaming token approximation** | Streaming responses use `fullContent.length` as a token proxy since providers don't emit token counts per chunk. This is inaccurate. A server-side tokenizer (tiktoken) would be more precise but adds a dependency. |

---

## What I Would Improve With More Time

- **Server-side SDK** — Provide a Node.js/Python SDK that handles batching, retries with exponential backoff, and queue-based ingestion for server-side LLM calls.
- **tiktoken integration** — Replace character-count token approximation with actual tokenizer counts for streaming responses.
- **Docker Compose** — One-command setup with Express + Redis + Vite in containers.
- **WebSocket-based real-time** — Replace polling dashboards with WebSocket push for live metric updates.
- **Dead-letter queue** — Configure BullMQ DLQ for failed ingest jobs with manual retry.
- **Multi-region ingestion** — Edge-deployed ingestion endpoints with regional queue routing.
- **Cost aggregation** — Per-user, per-model, per-project cost breakdown with budget alerts.
- **Grafana/Prometheus export** — Export metrics to Prometheus for Grafana dashboards.
- **End-to-end testing** — Integration tests that spin up Redis + Supabase and exercise the full ingestion pipeline.
- **Kubernetes manifests** — Helm charts or kustomize overlays for production deployment.

---

## License

MIT
