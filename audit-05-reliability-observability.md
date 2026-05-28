# Audit Report: Reliability & Observability

**Date:** 2026-05-28
**Auditor:** Production Audit Bot
**Severity Scale:** Critical / High / Medium / Low / Info

---

## 1. Executive Summary

The TraceLLM application has made meaningful investments in observability infrastructure — Pino structured logging, a Pino-based request logger middleware, an OpenTelemetry tracer module, request timing middleware, an in-memory internal metrics collector, and a health-check endpoint. However, the observability stack suffers from a critical integration gap: the OpenTelemetry tracer module is never imported by the server entry point, rendering the entire distributed tracing pipeline dead code. Additionally, the codebase has 25+ instances of raw `console.log/error/warn` calls that bypass the Pino logger entirely, undermining the centralized logging strategy.

On the reliability front, the application lacks circuit breakers for provider API calls, has no timeout isolation per provider request, uses empty `catch {}` blocks that silently swallow errors in 11 locations, and has no structured error taxonomy (errors are ad-hoc strings or generic `Error` objects). The SSE streaming endpoint does not audit disconnections, and there are no `process.on('unhandledRejection')` handlers to catch unhandled promise rejections. Graceful shutdown exists but does not properly drain HTTP connections before exit. The health check endpoint is present but basic.

## 2. Methodology

The audit was performed by reading the following source files: `server/index.js`, `server/services/tracer.js`, `server/services/telemetry.js`, `server/services/logger.js`, `server/services/failoverService.js`, `server/routes/chat.js`, `server/services/eventBus.js`, `server/routes/realtime.js`, `server/routes/ingest.js`, `server/services/auditService.js`, `server/middleware/requestTiming.js`, `server/services/providerAdapter.js`, `server/services/providers/openai.js`, `server/services/alertEvaluator.js`, `server/db/supabase.js`, `src/hooks/useRealtimeMetrics.js`, `src/stores/authStore.js`, `src/stores/projectStore.js`, `src/stores/themeStore.js`, `OBSERVABILITY.md`, and `package.json`. Grep searches were performed for `console.log`, `console.error`, `console.warn`, `catch {}`, `process.on('unhandledRejection'`, `process.on('uncaughtException'`, `class.*Error.*extends`, `timeout`, `AbortSignal`, and `--import tracer`.

## 3. Findings

### [FIND-001] OpenTelemetry Tracer Never Imported — Severity: Critical

- **Location:** `server/services/tracer.js:1-33`, `server/index.js:1-30`
- **Description:** `server/services/tracer.js` defines a complete OpenTelemetry SDK setup with `NodeSDK`, auto-instrumentations for HTTP, Express, and ioredis, and a `ConsoleSpanExporter`. However, `server/index.js` — the server entry point — does not import or execute this module. The entry point imports 20+ other modules but never `./services/tracer.js`. The `dev:server` script in `package.json` (`node server/index.js`) does not use `--import` or `--require` flags. The entire OpenTelemetry observability stack is dead code.
- **Impact:** Zero distributed tracing data is ever collected in any environment. Debugging production latency issues, distributed request flows, and dependency bottlenecks is impossible. The `OBSERVABILITY.md` documentation claims OTel is active "when `OTEL_ENABLED` is set or in production," but this is false.
- **Evidence:**

  ```js
  // server/index.js — imports (lines 1-30): no tracer import
  import "dotenv/config";
  import express from "express";
  // ... 20+ other imports ...
  import { logger, requestLogger } from "./services/logger.js";
  // No import of ./services/tracer.js or ./services/telemetry.js

  // package.json — dev:server script (line 8):
  "dev:server": "node server/index.js"
  // No --experimental-loader or --import flag for tracer
  ```

- **Recommendation:** Add `import "./services/tracer.js"` as the **first** import in `server/index.js` (before any other imports), or use a `--import` experimental flag in the `dev:server` script. The `startTelemetry()` function in `telemetry.js` should be called at startup. The `ConsoleSpanExporter` should be replaced with an `OTLPTraceExporter` for production.

### [FIND-002] `console.log/error/warn` Bypasses Pino Logger — Severity: High

- **Location:** 25+ instances across `server/` and `src/`
- **Description:** A Pino structured logger is configured in `server/services/logger.js` and used in many services, but 25+ locations use raw `console.log`, `console.error`, or `console.warn` instead of `logger.info/error/warn`. This includes critical error paths in `server/routes/chat.js:49`, `server/routes/metrics.js:22`, `server/services/alertEvaluator.js:124,135`, `server/services/webhookService.js:28`, `server/services/slackService.js:43`, `server/services/emailService.js:28`, and all `server/routes/conversations.js` error handlers (lines 24, 41, 57, 89).
- **Impact:** Logs from these paths are unstructured plain text, invisible to JSON log shipping, log aggregation (ELK/Datadog), and log-level filtering. Production debugging of errors in conversations, metrics, alerts, and webhook delivery is severely impaired.
- **Evidence:**

  ```js
  // server/routes/chat.js:49
  console.error("Chat error:", err);

  // server/routes/metrics.js:22
  console.error("Metrics error:", err);

  // server/services/alertEvaluator.js:124
  console.error("Alert evaluation error:", alert.id, err.message);
  ```

- **Recommendation:** Replace every `console.log/error/warn` call with the equivalent `logger.info/error/warn` structured call. Add an ESLint rule `no-console` to prevent regression. Affected files: `chat.js`, `metrics.js`, `conversations.js`, `alerts.js`, `projects.js`, `alertEvaluator.js`, `webhookService.js`, `slackService.js`, `emailService.js`, `metricsService.js`, `supabase.js`, `tracer.js`, `telemetry.js`.

### [FIND-003] No Circuit Breaker for Provider API Calls — Severity: High

- **Location:** `server/services/failoverService.js:47-71`
- **Description:** The `executeWithFailover` function iterates through providers and attempts each one sequentially. If a provider fails, it logs a warning and moves to the next. There is no circuit breaker pattern — no failure counting, no state tracking (`CLOSED`/`OPEN`/`HALF_OPEN`), no cooldown period, no automatic recovery. A provider that is consistently failing (e.g., rate-limited or down) will be retried on every request, causing increased latency for all users.
- **Impact:** When a provider is degraded, every request will incur the latency of attempting that provider before falling back. This can increase p95 latency by 5-30 seconds depending on provider timeouts. There is no mechanism to skip a known-bad provider.
- **Evidence:**
  ```js
  // server/services/failoverService.js:55-68
  for (const provider of providers) {
    try {
      const client = await lazyInitProvider(provider);
      if (!client) {
        logger.warn(
          { provider },
          "Failover: provider not configured, skipping",
        );
        continue;
      }
      const result = await execute(provider, client);
      return { provider, result };
    } catch (err) {
      logger.warn({ err, provider }, "Failover: provider failed, trying next");
      lastError = err;
    }
  }
  // No failure counting, no state tracking, no cooldown
  ```
- **Recommendation:** Implement a circuit breaker using the `opossum` package or a simple in-memory state machine. Track failures per provider over a sliding window. When the failure rate exceeds a threshold (e.g., 50% in 60 seconds), open the circuit and skip that provider for a cooldown period. Half-open probes should periodically test recovery.

### [FIND-004] No Timeout Isolation Per Provider Call — Severity: High

- **Location:** `server/routes/chat.js:28-38`, `server/services/providers/openai.js:7-12,26-31`
- **Description:** The chat route calls `adapter.chat()` and `adapter.streamChat()` without any timeout wrapping. The provider adapter functions (e.g., `createOpenAIAdapter`) call the OpenAI/Anthropic/Groq SDK directly with no `AbortSignal.timeout()` or `AbortController` timeout. If any provider's API hangs (network issue, upstream outage, DNS failure), the Node.js request will hang indefinitely, exhausting the server's connection pool and event loop.
- **Impact:** A single hung provider can cause cascading failure — all server worker threads blocked on stalled HTTP connections, resulting in 502 errors for all users. The Express server has no global timeout middleware.
- **Evidence:**

  ```js
  // server/routes/chat.js:28-38 — stream path, no timeout
  try {
    const streamIter = adapter.streamChat({ messages, model: resolvedModel });
    for await (const content of streamIter) { ... }

  // server/services/providers/openai.js:7-12 — no AbortSignal
  async chat({ messages, model, stream }) {
    const completion = await client.chat.completions.create({
      model: model || "gpt-4o-mini",
      messages,
      stream: !!stream,
    });
  ```

- **Recommendation:** Add a configurable timeout (e.g., 30s for non-streaming, 120s for streaming) to every provider call. Use `AbortSignal.timeout(ms)` or a `Promise.race` with a timeout. Add `express-timeout-handler` or `timeout` middleware to the Express app. The `failoverService.js` should also pass the timeout signal through to provider calls.

### [FIND-005] Health Check Endpoint Is Basic — Severity: Medium

- **Location:** `server/index.js:127-142`
- **Description:** The `/api/health` endpoint exists and checks database connectivity, but it does not verify Redis connectivity, queue health, or provider API key presence. A degraded Redis or a full dead-letter queue would still report `"status": "ok"`. The empty `catch {}` block (line 132) on the DB check silently swallows database errors.
- **Impact:** Orchestrators (Kubernetes liveness/readiness probes, Docker HEALTHCHECK) cannot distinguish between a fully healthy service and a partially degraded one. Auto-healing and auto-scaling decisions are based on incomplete data.
- **Evidence:**
  ```js
  // server/index.js:127-142
  app.get("/api/health", async (_req, res) => {
    let dbOk = false;
    try {
      const { data } = await supabase.from("projects").select("id").limit(1);
      dbOk = Array.isArray(data);
    } catch {
      // DB check failed — respond with degraded status
    }
    res.json({
      status: dbOk ? "ok" : "degraded",
      service: "TraceLLM API",
      version: "2.0.0",
      uptime_ms: Date.now() - startTime,
      database: dbOk ? "connected" : "disconnected",
    });
  });
  ```
- **Recommendation:** Add checks for Redis connectivity (if `REDIS_URL` is set), BullMQ queue health (waiting/failed counts), and provider API key presence. Return a detailed `checks` object with per-dependency status. Use an HTTP status code 503 when any critical dependency is unhealthy. Log the health check result for observability. Add a `HEALTHCHECK` instruction to `Dockerfile.backend`.

### [FIND-006] No Structured Error Taxonomy — Severity: Medium

- **Location:** Entire codebase (`grep` for `class.*Error.*extends` returned no results)
- **Description:** There are no custom error classes anywhere in the codebase. Errors are thrown as generic `new Error("...")` strings or ad-hoc objects. The global error handler in `server/index.js:178-181` catches everything and returns a generic `"Internal server error"` message. There is no `AppError`, `ApiError`, `ValidationError`, `ProviderError`, or `AuthenticationError` hierarchy.
- **Impact:** Error handling is inconsistent. Downstream consumers (API clients, alerting systems) cannot programmatically distinguish error types. The global error handler cannot apply different status codes or recovery strategies per error type. Error monitoring tools (Sentry, DataDog) lose error classification context.
- **Evidence:**

  ```js
  // server/index.js:178-181 — global error handler
  app.use((err, req, res, _next) => {
    logger.error({ err }, "Unhandled error");
    res.status(500).json({ error: "Internal server error" });
  });

  // Failover service (line 70) — generic Error
  throw lastError || new Error("All providers exhausted");
  ```

- **Recommendation:** Create a `server/errors.js` module with a base `AppError` class extending `Error`, plus subclasses: `ProviderError`, `ValidationError`, `AuthenticationError`, `RateLimitError`, `NotFoundError`. Each should carry `statusCode`, `code` (string), and `details`. Update the global error handler to inspect `err.statusCode` and `err.code`. Update middleware and routes to use these custom error classes.

### [FIND-007] No Audit Log for SSE Disconnections/Reconnections — Severity: Medium

- **Location:** `server/routes/realtime.js:37-42`, `src/hooks/useRealtimeMetrics.js:52-56`
- **Description:** The SSE streaming endpoint in `realtime.js` listens for `req.on("close")` to clean up event listeners and heartbeat intervals, but it does not log the disconnection to the audit log or application logger. The frontend `useRealtimeMetrics.js` hook attempts reconnection after 3 seconds on `onerror`, but this reconnection event is never logged. There is no monitoring of how often SSE connections drop or how many concurrent connections exist.
- **Impact:** SSE connection instability is invisible to operations. If the real-time dashboard frequently disconnects and reconnects, no one will know unless a user reports it. Debugging SSE reliability issues requires correlation of disconnection events, which is impossible without logging.
- **Evidence:**

  ```js
  // server/routes/realtime.js:37-42 — no audit log in close handler
  req.on("close", () => {
    clearInterval(heartbeat);
    unsubMetrics?.();
    unsubHealth?.();
    unsubAlerts?.();
  });

  // src/hooks/useRealtimeMetrics.js:52-56 — reconnection, no logging
  source.onerror = () => {
    setConnected(false);
    setError("Connection lost. Reconnecting...");
    source.close();
    reconnectRef.current = setTimeout(connect, 3000);
  };
  ```

- **Recommendation:** Add `logger.warn()` calls in the `req.on("close")` handler in `realtime.js` to log disconnection events, including client IP, project ID, and connection duration. Log reconnection attempts from the frontend hook via a callback or a logging endpoint. Add a Prometheus counter or in-memory metric for SSE disconnection rate.

### [FIND-008] No `process.on('unhandledRejection')` Handler — Severity: Critical

- **Location:** `server/index.js`, entire codebase
- **Description:** A grep for `unhandledRejection` and `uncaughtException` returned zero results. Node.js will emit a warning for unhandled promise rejections, but starting from Node 15+, unhandled rejections cause the process to exit with a non-zero exit code. Any unchecked `await` or `.catch()` omission (e.g., in cron jobs, queue workers, or streaming routes) can crash the entire server without warning.
- **Impact:** An unhandled promise rejection in any async route, cron job, or queue worker will crash the production server. This is the highest-severity reliability issue because it causes total service unavailability without any recovery mechanism.
- **Evidence:**
  ```bash
  # grep for unhandledRejection — zero results
  grep -r "unhandledRejection" --include="*.js" .
  # grep for uncaughtException — zero results
  grep -r "uncaughtException" --include="*.js" .
  ```
- **Recommendation:** Add the following to `server/index.js` immediately after imports:
  ```js
  process.on("unhandledRejection", (reason, promise) => {
    logger.fatal({ err: reason }, "Unhandled promise rejection");
    // Optionally, exit and let the process manager restart
    process.exit(1);
  });
  process.on("uncaughtException", (err) => {
    logger.fatal({ err }, "Uncaught exception");
    process.exit(1);
  });
  ```

### [FIND-009] Graceful Shutdown Does Not Drain Connections — Severity: Medium

- **Location:** `server/index.js:212-223`
- **Description:** The `shutdown` function handles SIGINT/SIGTERM by calling `server.close()` and `shutdownQueue()`, then calling `process.exit(0)`. However, `server.close()` stops accepting new connections but does not force-drain existing keep-alive connections. If there are long-lived SSE connections or in-flight streaming chat requests, the process will exit before they complete. There is no forced timeout to ensure the process eventually exits if connections hang.
- **Impact:** In-flight streaming chat responses are truncated. SSE clients receive abrupt disconnections instead of graceful close frames. The process may hang indefinitely if connections do not close, preventing the orchestrator from restarting the container.
- **Evidence:**
  ```js
  // server/index.js:212-223
  async function shutdown(signal) {
    logger.info({ signal }, "Shutdown signal received");
    server.close(() => {
      logger.info("HTTP server closed");
    });
    await shutdownQueue();
    logger.info("Shutdown complete");
    process.exit(0);
  }
  // No forced timeout on server.close()
  // No explicit destruction of keep-alive connections
  ```
- **Recommendation:** Track active connections using `server.on("connection", ...)`. In the shutdown handler, destroy all tracked sockets after a grace period (e.g., 10 seconds). Use a `setTimeout` to force `process.exit(1)` if graceful shutdown takes too long. The SSE endpoint should send a close event to clients before shutting down.

### [FIND-010] Empty `catch {}` Blocks Silently Swallow Errors — Severity: High

- **Location:** 11 occurrences across `server/` and `src/`
- **Description:** Empty `catch {}` blocks (without even a comment) are used in multiple critical paths. These include the health check DB probe (`server/index.js:132`), queue metrics polling (`server/services/queueService.js:136`), RBAC permission check (`server/middleware/rbac.js:80`), SSE message parsing (`src/hooks/useRealtimeMetrics.js:47`), and theme store localStorage access (`src/stores/themeStore.js:13,49`). Some have comments but no actual error handling.
- **Impact:** Errors are invisible to operations. A failing queue metrics poll, a corrupt SSE message, or a failing RBAC query will fail silently, leading to stale data in the dashboard, silently denied access, or undiagnosed performance degradation.
- **Evidence:**

  ```js
  // server/index.js:132 — health check, error silently swallowed
  } catch {
    // DB check failed — respond with degraded status
  }

  // server/services/queueService.js:136 — queue metrics polling
  } catch {
    // ignore poll error
  }

  // server/middleware/rbac.js:80 — permission check returns false on any error
  } catch {
    return false;
  }

  // src/hooks/useRealtimeMetrics.js:47 — SSE parse errors
  } catch {
    // ignore parse errors
  }
  ```

- **Recommendation:** Never use empty `catch` blocks. At minimum, log the error with `logger.warn` or `logger.error`. For non-critical paths (e.g., localStorage), log at `debug` level. For critical paths (e.g., RBAC, health check), the error should either be re-thrown, handled explicitly, or logged with context.

## 4. Positive Highlights

1. **Pino logger with structured serializers** (`server/services/logger.js`): The logger configuration is production-grade, with custom serializers for `req`, `res`, and `err` objects, configurable log level via `LOG_LEVEL` env var, and pino-pretty for development.

2. **Request timing middleware** (`server/middleware/requestTiming.js`): Every request is timed with DB and total duration tracking, exposed via `X-Response-Time-MS` and `X-DB-Time-MS` headers. This is valuable for performance monitoring.

3. **Internal metrics endpoint** (`server/routes/internal.js`): `GET /api/internal/metrics` exposes request counts, latency averages, error rates, queue sizes, and active users — a solid foundation for operational dashboards.

4. **Provider health endpoint** (`server/index.js:225-261`): The `/api/provider-health` endpoint computes per-provider health status based on recent inference logs with configurable thresholds (`healthy`/`degraded`/`down`/`unknown`).

5. **Queue retry with dead-letter queue** (`server/services/queueService.js`): BullMQ jobs have exponential backoff with 3 retry attempts and a dead-letter queue for permanent failures.

6. **Graceful shutdown exists** (`server/index.js:212-223`): SIGINT/SIGTERM handlers are registered and properly sequence server close, queue shutdown, and Redis disconnection.

7. **Webhook retry with exponential backoff** (`server/services/webhookRetryService.js`): Webhook deliveries use exponential backoff with configurable max attempts and `AbortSignal.timeout`.

## 5. Risk Scoring Summary

| ID       | Title                                           | Severity | Effort to Fix |
| -------- | ----------------------------------------------- | -------- | ------------- |
| FIND-001 | OpenTelemetry Tracer Never Imported             | Critical | 1h            |
| FIND-008 | No `process.on('unhandledRejection')` Handler   | Critical | 30min         |
| FIND-002 | `console.log/error/warn` Bypasses Pino Logger   | High     | 2h            |
| FIND-003 | No Circuit Breaker for Provider API Calls       | High     | 4h            |
| FIND-004 | No Timeout Isolation Per Provider Call          | High     | 2h            |
| FIND-010 | Empty `catch {}` Blocks Silently Swallow Errors | High     | 1h            |
| FIND-005 | Health Check Endpoint Is Basic                  | Medium   | 1h            |
| FIND-006 | No Structured Error Taxonomy                    | Medium   | 3h            |
| FIND-007 | No Audit Log for SSE Disconnections             | Medium   | 2h            |
| FIND-009 | Graceful Shutdown Does Not Drain Connections    | Medium   | 2h            |

## 6. Recommendations by Priority

### Immediate (fix within sprint)

1. **FIND-001**: Import `tracer.js` or call `startTelemetry()` as the first line in `server/index.js` to activate the entire OpenTelemetry stack.
2. **FIND-008**: Add `process.on('unhandledRejection')` and `process.on('uncaughtException')` handlers with fatal logging and process exit.
3. **FIND-010**: Replace all 11 empty `catch {}` blocks with at minimum a `logger.warn/debug` call.
4. **FIND-002**: Replace all 25+ `console.log/error/warn` calls with `logger.info/error/warn` and add an ESLint `no-console` rule.

### Short-term (next 2 sprints)

5. **FIND-004**: Add `AbortSignal.timeout()` to all provider SDK calls in `server/services/providers/*.js` and the `server/routes/chat.js` streaming path.
6. **FIND-009**: Implement proper connection draining with tracked sockets, a forced-shutdown timeout, and SSE close-frame broadcasting.
7. **FIND-005**: Expand the health check to cover Redis, queue, and provider dependencies. Add `HEALTHCHECK` to `Dockerfile.backend`.

### Long-term (roadmap)

8. **FIND-003**: Implement circuit breakers for each provider using `opossum` or a custom state machine with configurable thresholds and cooldown periods.
9. **FIND-006**: Create a structured error taxonomy (`AppError` base class with subclasses) and update all middleware and routes to use it.
10. **FIND-007**: Add SSE disconnection/reconnection logging on both server and client, with Prometheus counters or in-memory metrics for monitoring SSE stability.
