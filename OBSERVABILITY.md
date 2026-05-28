# Observability

## Logging

TraceLLM uses **Pino** for structured JSON logging. All logs include:

- `timestamp` — ISO 8601
- `level` — trace/debug/info/warn/error/fatal
- `req.id` — unique request ID (UUID)
- `req.method` — HTTP method
- `req.url` — request path
- `res.statusCode` — HTTP response status
- `duration_ms` — request processing time

### Log Levels

| Level | When |
|-------|------|
| `debug` | Development details (disabled in prod) |
| `info` | Request summaries, lifecycle events |
| `warn` | CSP violations, retry attempts |
| `error` | Failed operations, unhandled errors |
| `fatal` | Missing required configuration |

## Request Timing

Every request is timed via `requestTiming` middleware. Timing is attached to:

- `req._timing.total` — total request duration
- `req._timingDBTotal` — cumulative DB query time
- Response headers: `X-Response-Time-MS`, `X-DB-Time-MS`

## OpenTelemetry

When `OTEL_ENABLED` is set (or in production), OpenTelemetry instruments:

- HTTP requests (via `@opentelemetry/instrumentation-http`)
- Express routes (via `@opentelemetry/instrumentation-express`)
- Redis operations (via `@opentelemetry/instrumentation-ioredis`)

Spans are exported to the console by default. Configure an OTLP exporter for production:

```bash
OTEL_EXPORTER_OTLP_ENDPOINT=http://your-collector:4318
```

## Internal Metrics

`GET /api/internal/metrics` exposes:

- `requests_total` — lifetime request count
- `requests_per_second` — average throughput
- `avg_latency_ms` — average response time
- `error_count` / `error_rate_percent`
- `active_users` — unique user IDs seen
- `total_inferences` — rows in inference_logs
- `queue.*` — BullMQ queue sizes
- `token_usage_total` — accumulated token count

## Provider Health

`GET /api/provider-health` returns per-provider status based on the last 5 minutes:

- `healthy` — >90% success rate
- `degraded` — 70-90% success rate
- `down` — <70% success rate
- `unknown` — no recent data

## SSE Real-Time Dashboard

Metrics broadcast every 10 seconds via Server-Sent Events. The stream delivers:

- `metrics` — aggregated metrics for the project
- `provider_health` — per-provider health status
- `alerts` — triggered alert events

## Queue Monitoring

`GET /api/queue/status` returns BullMQ queue sizes. `GET /api/queue/failed` lists dead-letter jobs.
