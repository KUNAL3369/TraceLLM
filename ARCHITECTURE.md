# TraceLLM Architecture

## System Overview

TraceLLM is a lightweight LLM inference logging and observability platform. It intercepts LLM API calls through a client SDK, captures telemetry, and provides real-time dashboards for monitoring latency, tokens, errors, and usage across multiple AI providers.

```
┌─────────────────────────────────────────────────────────┐
│                     Browser (React)                      │
│                                                          │
│  Chat UI ──► SDK (sdk.js) ──► Telemetry              │
│       │                            │                     │
│       │  POST /api/chat            │  POST /api/ingest   │
│       ▼                            ▼                     │
└─────────────────────────────────────────────────────────┘
                         │
                    HTTP API
                         │
┌────────────────────────┼─────────────────────────────────┐
│                        ▼                                 │
│              Express API (server/)                        │
│                                                          │
│  ┌──────────┐  ┌──────────────┐  ┌──────────────────┐   │
│  │ Chat     │  │ Ingestion    │  │ Provider         │   │
│  │ Router   │  │ Router       │  │ Adapter Factory  │   │
│  │ /chat    │  │ /ingest      │  │                  │   │
│  └────┬─────┘  └──────┬───────┘  └────────┬─────────┘   │
│       │               │                    │             │
│       ▼               ▼                    ▼             │
│  ┌──────────┐  ┌──────────────┐  ┌──────────────────┐   │
│  │ Zod      │  │ Rate Limit   │  │ OpenAI / Anthropic│   │
│  │ Validate │  │ + Auth       │  │ Groq / OpenRouter│   │
│  └──────────┘  └──────┬───────┘  └──────────────────┘   │
│                       │                                  │
│                ┌──────▼──────┐                           │
│                │  BullMQ     │────► Worker (PII, write)  │
│                │  (optional) │                           │
│                └──────┬──────┘                           │
│                       │ (direct fallback)                │
└───────────────────────┼──────────────────────────────────┘
                        │
                        ▼
              ┌──────────────────┐
              │    Supabase      │
              │   PostgreSQL     │
              │                  │
              │  12 tables       │
              │  28 indexes      │
              │  RLS enabled     │
              └──────────────────┘
```

---

## Ingestion Flow

### Step-by-step

1. **SDK capture** (`src/lib/sdk.js`)
   - `chatCompletion()` wraps every LLM call
   - Captures: provider, model, latency (via `performance.now()`), token counts, status, error type, session ID, conversation ID, request/response previews (first 200 chars)
   - Streaming: collects chunks, approximates tokens via character count
   - Non-streaming: reads `usage` object from provider response

2. **Telemetry submission**
   - `ingestLog()` POSTs to `/api/ingest`
   - Fire-and-forget with retry: up to 3 attempts with exponential backoff (500ms, 1s, 2s)
   - Failed payloads queued in memory and retried on next successful submission
   - Only retries on network errors, 5xx, and 429 — not on 4xx client errors

3. **Server processing** (`server/routes/ingest.js`)
   - **Rate limit check**: 300 req/min on ingest endpoint (via `express-rate-limit`)
   - **API key auth**: SHA-256 hash lookup against `api_keys` table
   - **Usage limit check**: Verifies project's monthly limit hasn't been exceeded
   - **Zod validation**: Enforces schema (provider, model, latency, tokens, status)
   - **PII redaction**: If project has `pii_redaction_enabled=true`, redacts emails, phones, CCs, API keys, tokens, passwords from previews
   - **BullMQ queue** (optional): If Redis configured, enqueues job and returns 202. Worker processes with concurrency 5.
   - **Direct write** (fallback): Inserts to `inference_logs` table synchronously. Returns 201.

4. **Database write** (`server/db/schema.sql`)
   - `inference_logs` row inserted with all metadata
   - `usage_tracking` row upserted for monthly counters
   - RLS ensures tenant isolation

### Data Flow Diagram (SDK → DB)

```
Browser                          Server                         Database
  │                                │                               │
  │  POST /api/ingest              │                               │
  ├───────────────────────────────►│                               │
  │                                │  ┌─────────────────┐         │
  │                                │  │ Rate Limit      │         │
  │                                │  │ (300/min)       │         │
  │                                │  └────────┬────────┘         │
  │                                │           ▼                   │
  │                                │  ┌─────────────────┐         │
  │                                │  │ API Key Auth    │         │
  │                                │  │ (SHA-256 hash)  │         │
  │                                │  └────────┬────────┘         │
  │                                │           ▼                   │
  │                                │  ┌─────────────────┐         │
  │                                │  │ Usage Limit     │──► 429  │
  │                                │  └────────┬────────┘         │
  │                                │           ▼                   │
  │                                │  ┌─────────────────┐         │
  │                                │  │ Zod Validation  │──► 400  │
  │                                │  └────────┬────────┘         │
  │                                │           ▼                   │
  │                                │  ┌─────────────────┐         │
  │                                │  │ PII Redaction   │         │
  │                                │  │ (if enabled)    │         │
  │                                │  └────────┬────────┘         │
  │                                │           ▼                   │
  │                                │  ┌─────────────────┐         │
  │                                │  │ Redis/BullMQ?   │         │
  │                                │  └────┬──────┬─────┘         │
  │                                │     Yes      No              │
  │                                │       │        │              │
  │                                │       ▼        ▼              │
  │                                │  ┌────────┐ ┌────────┐      │
  │                                │  │ Queue  │ │ Direct │      │
  │                                │  │ (202)  │ │ (201)  │      │
  │                                │  └───┬────┘ └───┬────┘      │
  │                                │       │          │           │
  │                                │       │          └──────────►│
  │                                │       │                      │
  │                                │  ┌────▼─────┐               │
  │                                │  │  Worker  │               │
  │                                │  │ (PII +   │──────────────►│
  │                                │  │  insert) │               │
  │                                │  └──────────┘               │
  │                                │                              │
  │  ← 201/202/429/400             │                              │
  │◄───────────────────────────────│                              │
```

---

## Logging Strategy

### What metadata is captured per inference call

| Field | Source | Example |
|-------|--------|---------|
| `provider` | SDK parameter | `"openai"` |
| `model` | SDK parameter | `"gpt-4o-mini"` |
| `latency_ms` | `performance.now()` delta | `1247` |
| `prompt_tokens` | Provider API response | `45` |
| `completion_tokens` | Provider API response | `120` |
| `total_tokens` | Provider API response | `165` |
| `status` | Request outcome | `"success"` |
| `error_type` | Error message | `"rate_limit_exceeded"` |
| `request_preview` | Last user message (first 200 chars) | `"What is the capital of..."` |
| `response_preview` | Assistant response (first 200 chars) | `"The capital of France is..."` |
| `session_id` | Generated per chat session | `"session_1712345678"` |
| `conversation_id` | Chat conversation UUID | `"abc-123-def"` |
| `project_id` | From API key auth | `"proj-xyz"` |

### Streaming telemetry

For streaming responses, the SDK collects chunks in `fullContent`, approximates `completion_tokens` as `fullContent.length` (character count). Actual token counts are not available from providers during streaming. A tiktoken-based tokenizer would improve accuracy.

### Error telemetry

On error, tokens default to 0, `status` is `"error"`, and `error_type` contains the error message. This allows error rate dashboards and provider reliability tracking.

---

## Scaling Considerations

### Queue mode (BullMQ + Redis)

- **Concurrency**: Worker processes 5 jobs simultaneously
- **Rate limit**: 50 jobs/second per worker
- **Retries**: 3 attempts with exponential backoff (2s base)
- **Job retention**: 1000 completed, 100 failed (prevents unbounded storage)
- **Horizontal scaling**: Multiple worker instances can consume from the same queue

### Direct mode (no Redis)

- Synchronous DB writes — each request blocks until the insert completes
- Limited by Supabase connection pool (default: 15 connections)
- Suitable for low-volume deployments (< 100 req/min)

### Database indexing

28 indexes support the most common query patterns:
- `(project_id, created_at DESC)` — composite index for dashboard time-series queries
- Individual indexes on `provider`, `model`, `status`, `error_type`, `latency_ms` — filter-based queries
- `key_hash` unique index — fast API key authentication

### Aggregation tradeoffs

The `/api/metrics` endpoint computes aggregates on-the-fly from `inference_logs`. For high-volume deployments, pre-aggregated materialized views or rollup tables would reduce query load. The current approach trades query speed for simplicity and always-fresh data.

---

## Failure Assumptions

### API gateway down
- **Effect**: Ingestion endpoint unreachable; SDK retries 3 times, then queues payloads in memory
- **Recovery**: Queued payloads sent on next successful ingestion
- **Risk**: In-memory queue lost on page refresh; acceptable for a client-side SDK

### Redis unavailable
- **Effect**: BullMQ queue returns null; ingestion falls back to synchronous DB writes
- **Recovery**: Automatic — no config change needed
- **Risk**: Higher request latency during synchronous writes

### LLM provider failures
- **Effect**: Provider returns 4xx/5xx; adapter throws error; chat route returns error to user
- **Recovery**: User switches provider via the dropdown; retry sends new request
- **Monitoring**: Error logged in `inference_logs` with `error_type`; error rate dashboards reflect failures

### Database unavailable
- **Effect**: Ingestion returns 500; SDK retries with backoff; alerts don't trigger
- **Recovery**: Requires database restoration; no failover mechanism currently
- **Mitigation**: Supabase provides automated backups; connection pooling reduces outage risk

### Network issues (client-side)
- **Effect**: SDK's `fetchWithRetry` retries up to 3 times with backoff
- **Recovery**: If all retries fail, payload queued in memory for later retry
- **Limitation**: No localStorage persistence for the retry queue (page refresh clears pending payloads)

---

## Security Architecture

### Authentication layers

```
┌────────────────────────────────────────────────────┐
│                  Request                            │
│                                                     │
│  ┌──────────────┐     ┌──────────────────────┐     │
│  │ SDK/External  │     │  Browser (Dashboard) │     │
│  │ API Key Auth  │     │  Supabase JWT Auth   │     │
│  │ (SHA-256)     │     │  (userAuth middleware)│    │
│  └───────┬───────┘     └──────────┬───────────┘     │
│          │                        │                  │
│          ▼                        ▼                  │
│  Used for:                  Used for:                │
│  /api/ingest                /api/projects            │
│  (SDK telemetry)            /api/conversations        │
│                              /api/alerts              │
│                              /api/billing             │
│                              /api/audit               │
└──────────────────────────────────────────────────────┘
```

### API key authentication (`server/middleware/apiKeyAuth.js`)

1. Client sends key in `Authorization: Bearer <key>` or `x-api-key` header
2. Server SHA-256 hashes the raw key
3. Looks up hash in `api_keys` table
4. Rejects if not found or status != "active" (401)
5. Updates `last_used_at` timestamp
6. Sets `req.projectId` for downstream handlers

Keys are never stored in plaintext. The raw key is displayed once at creation.

### User authentication (`server/middleware/apiKeyAuth.js`)

1. Client sends Supabase JWT in `Authorization: Bearer <token>` header
2. Server validates via `supabase.auth.getUser(token)`
3. Rejects if invalid/expired (401)
4. Sets `req.userId` for downstream handlers

### Tenant isolation (Row-Level Security)

All 12 tables have RLS enabled. Every policy chains through `organizations.owner_user_id`:

```sql
CREATE POLICY "Users can view their inference logs"
  ON inference_logs FOR SELECT
  USING (
    project_id IN (
      SELECT p.id FROM projects p
      JOIN organizations o ON o.id = p.organization_id
      WHERE o.owner_user_id = auth.uid()
    )
  );
```

This ensures tenant isolation at the database level — even if an auth bypass occurs, RLS prevents cross-tenant data access.

### PII redaction (`server/services/piiRedaction.js`)

Regex-based detection and redaction for 7 categories:
- Emails → `[REDACTED_EMAIL]`
- Phone numbers → `[REDACTED_PHONE]`
- Credit card numbers → `[REDACTED_CC]`
- API keys (sk-, tracellm_, gsk_ patterns) → `[REDACTED_API_KEY]`
- Bearer tokens → `Bearer [REDACTED_TOKEN]`
- Passwords → `password=[REDACTED]`
- JWTs → `[REDACTED_JWT]`

Applied to `request_preview` and `response_preview` fields when `pii_redaction_enabled` is true on the project. Applied in both direct-write path and BullMQ worker.
