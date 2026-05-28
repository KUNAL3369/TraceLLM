# TraceLLM API Documentation

Base URL: `http://localhost:3001/api`

## Authentication

### Session Auth (`userAuth`)
Used for most endpoints. Expects a valid Supabase session JWT in the `Authorization: Bearer <token>` header. Obtained via `supabase.auth.signIn()` or `supabase.auth.signUp()` on the frontend.

### API Key Auth (`apiKeyAuth`)
Used for the ingestion endpoint. Expects project API key in the `x-api-key` header. Each project gets a unique key stored in `projects.api_key`.

## Endpoints

### Health Check

```
GET /api/health
```

Response:
```json
{
  "status": "ok",
  "service": "TraceLLM API",
  "version": "2.0.0",
  "uptime_ms": 1234567,
  "database": "connected"
}
```

---

### Ingest Inference Logs

```
POST /api/ingest
```

Headers: `x-api-key: <project_api_key>`

Request body:
```json
{
  "model": "gpt-4",
  "provider": "openai",
  "latency_ms": 1234,
  "status": "success",
  "tokens_prompt": 150,
  "tokens_completion": 300,
  "cost_cents": 2.5,
  "request_id": "req_abc123",
  "project_id": "uuid",
  "user_id": "uuid (optional)",
  "session_id": "sess_abc (optional)",
  "error_message": "null or string"
}
```

Response (201):
```json
{
  "success": true,
  "id": "log-uuid"
}
```

Response (401):
```json
{
  "error": "Invalid API key"
}
```

---

### Chat Completion (SSE Stream)

```
POST /api/chat
```

Headers: `Authorization: Bearer <session_jwt>`

Request body:
```json
{
  "model": "openai/gpt-4o-mini",
  "provider": "openrouter",
  "messages": [
    { "role": "user", "content": "Hello" }
  ],
  "stream": true,
  "conversation_id": "uuid (optional)"
}
```

Response: Server-Sent Events stream with `data:` lines. Each event is one of:

```json
// Token delta
{ "type": "delta", "content": "Hel" }

// Final message with metadata
{ "type": "message", "content": "Hello!", "role": "assistant" }

// Error
{ "type": "error", "content": "Error message" }
```

Supported providers: `openai`, `anthropic`, `groq`, `openrouter`.

---

### Conversations

```
GET /api/conversations
```

Headers: `Authorization: Bearer <session_jwt>`

Response (200):
```json
[
  {
    "id": "uuid",
    "title": "My Chat",
    "project_id": "uuid",
    "created_at": "iso-string"
  }
]
```

```
POST /api/conversations
```

Request body:
```json
{
  "title": "New Chat",
  "project_id": "uuid"
}
```

Response (201): `{ "id": "uuid", "title": "New Chat", ... }`

```
POST /api/conversations/:id/messages
```

Request body:
```json
{
  "role": "user",
  "content": "Hello"
}
```

Response (201): `{ "id": "uuid", "conversation_id": "uuid", "role": "user", "content": "Hello" }`

---

### Metrics

```
GET /api/metrics?project_id=uuid
```

Headers: `Authorization: Bearer <session_jwt>`

Response (200):
```json
{
  "summary": {
    "total_requests": 5000,
    "successful_requests": 4800,
    "failed_requests": 200,
    "avg_latency": 320,
    "p95_latency": 890,
    "total_prompt_tokens": 750000,
    "total_completion_tokens": 1500000,
    "total_tokens": 2250000,
    "active_sessions": 42,
    "requests_per_minute": 12
  },
  "trends": [
    { "time": "14:30", "requests": 15, "latency": 310, "tokens": 4500 }
  ],
  "providers": [
    { "name": "openai", "value": 65 }
  ],
  "models": [
    { "name": "gpt-4", "count": 120 }
  ],
  "cost": {
    "estimated_total": 12.50,
    "by_provider": { "openai": 12.50 }
  }
}
```

---

### Provider Health

```
GET /api/provider-health
```

Response (200):
```json
[
  {
    "provider": "openai",
    "status": "healthy",
    "avg_latency_ms": 450,
    "success_rate": 99,
    "recent_requests": 85,
    "recent_errors": 1
  }
]
```

Status values: `healthy` (>90% success), `degraded` (70-90%), `down` (<70%), `unknown` (no data).

---

### Alerts

```
GET /api/alerts/events?project_id=uuid
```

Response (200):
```json
[
  {
    "id": "uuid",
    "alerts": { "name": "High Latency", "condition_type": "p95_latency", "threshold": 1000 },
    "triggered_value": 1200,
    "status": "triggered",
    "triggered_at": "iso-string"
  }
]
```

---

### Projects

```
GET /api/projects
```

Response (200): `[{ "id": "uuid", "name": "My Project", "created_at": "iso-string" }]`

---

### Real-Time Metrics Stream (SSE)

```
GET /api/realtime/metrics/stream?project_id=uuid
```

Headers: `Authorization: Bearer <session_jwt>`

Response: Server-Sent Events. Each event is:

```
event: metrics
data: { "summary": {...}, "trends": [...], "providers": [...], "cost": {...} }

event: provider-health
data: [...]

event: alerts
data: [...]

event: connected
data: {}
```

Events are broadcast every 10 seconds. The stream stays open indefinitely; the client must reconnect on error.

---

### Billing

```
GET /api/billing/usage?project_id=uuid
```

Response (200):
```json
{
  "plan": "free",
  "requests_used": 500,
  "requests_limit": 1000,
  "resets_at": "iso-string"
}
```

---

## Error Responses

All errors follow this shape:

```json
{ "error": "Description of what went wrong" }
```

Status codes:
- `400` — Bad request (missing/invalid fields)
- `401` — Unauthorized (missing/invalid auth)
- `404` — Not found
- `429` — Rate limited
- `500` — Internal server error

## Rate Limits

- General API: 100 requests per minute per IP
- Ingestion: 300 requests per minute per API key
