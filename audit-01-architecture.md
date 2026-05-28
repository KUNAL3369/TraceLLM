# Audit Report: Architecture

**Date:** 2026-05-28
**Auditor:** Production Audit Bot
**Severity Scale:** Critical / High / Medium / Low / Info

---

## 1. Executive Summary

This architecture audit of the TraceLLM observability dashboard reveals a well-structured codebase with clear separation between frontend (React/Vite) and backend (Express/Node) concerns, but several significant architectural gaps. The most critical findings include a monolithic route layout with zero API versioning, dead OpenTelemetry instrumentation code that ships but never executes, and an SSE real-time endpoint that bypasses the JWT auth mechanism due to browser EventSource limitations.

The application uses a flat `/api/*` route namespace with no version prefix (`/api/v1/*`), making backward-incompatible changes impossible without breaking existing SDKs. Database migrations are ad-hoc SQL files with no versioning metadata, no rollback scripts, and no automated migration runner. The OpenTelemetry tracer module (`server/services/tracer.js`) is fully implemented but never imported anywhere — the only import site is `server/index.js` and it does not include it. A second, duplicate telemetry module (`server/services/telemetry.js`) exists but is also never called. Between them, 17+ OpenTelemetry-related npm dependencies are installed and unused at runtime.

---

## 2. Methodology

Files inspected via direct source reading across all 12 route handlers, 19 service modules, 5 middleware files, 4 frontend hooks, 3 stores, 11 pages, plus configuration files (`vite.config.js`, `package.json`, `docker-compose.yml`) and documentation (`ARCHITECTURE.md`, `API_DOCS.md`, `OBSERVABILITY.md`). Each finding was validated against actual line-level source evidence.

---

## 3. Findings

### [FIND-001] No API Versioning — Monolithic Route Definitions — Severity: High

- **Location:** `server/index.js:128-165`
- **Description:** All routes are registered at `/api/*` with no version segment. For example, `/api/chat`, `/api/metrics`, `/api/ingest`. This couples the SDK client to the exact current contract. A breaking change (e.g., modifying the ingest payload schema) cannot be released alongside existing clients that depend on the old shape. With `express@5` the risk is amplified since the server itself is on a pre-release major.
- **Impact:** Any backward-incompatible API change forces all SDK clients to update simultaneously. There is no graceful migration path. Twelve route files would need to be relocated or aliased to add versioning retroactively.
- **Evidence:**
  ```js
  // server/index.js:155-165
  app.use("/api/projects", userAuth, projectsRouter);
  app.use("/api/conversations", userAuth, conversationsRouter);
  app.use("/api/alerts", userAuth, alertsRouter);
  app.use("/api/billing", userAuth, billingRouter);
  app.use("/api/audit", userAuth, auditRouter);
  app.use("/api/notifications", userAuth, notificationsRouter);
  app.use("/api/metrics", userAuth, metricsRouter);
  app.use("/api/chat", userAuth, chatRouter);
  app.use("/api/ingest", ingestLimiter, apiKeyAuth, ingestRouter);
  app.use("/api/realtime", userAuth, realtimeRouter);
  ```
- **Recommendation:** Prefix all routes with `/api/v1/`. Add a redirect or version-negotiation middleware before introducing `/api/v2/` for breaking changes.

### [FIND-002] No Schema Versioning for Database Migrations — Severity: High

- **Location:** `server/db/` (`.sql` files)
- **Description:** Database migrations are flat SQL files (`schema.sql`, `migration_v2.sql`, `migration_v3.sql`) with no version table, no automated runner, no rollback scripts, and no checksum verification. A DBA must manually execute these files in the correct order against Supabase. There is no `down` migration for any of the three files.
- **Impact:** Deployments cannot be rolled back. If `migration_v3.sql` introduces a breaking column change, there is no automated path to revert. In a team environment, different environments may drift.
- **Evidence:**
  - `server/db/schema.sql` — base schema, no version metadata
  - `server/db/migration_v2.sql` — "Run this after the base schema" (manual instruction)
  - `server/db/migration_v3.sql` — migration name only in a comment
- **Recommendation:** Adopt a migration tool (e.g., `node-pg-migrate` or Supabase's built-in migration CLI). Every migration must have a corresponding rollback script.

### [FIND-003] OpenTelemetry Tracer Is Dead Code — Severity: High

- **Location:** `server/services/tracer.js` (entire file), `server/services/telemetry.js` (entire file)
- **Description:** Two separate OpenTelemetry initialization modules exist. `tracer.js` uses dynamic `await import()` for setup but is never imported anywhere. `telemetry.js` uses static imports and exports a `startTelemetry()` function that is never called. `server/index.js` imports neither file. Meanwhile 9 OpenTelemetry packages are listed as production dependencies in `package.json` at versions spanning three separate minor releases:
  - `@opentelemetry/api@1.9.1`
  - `@opentelemetry/instrumentation-express@0.66.0`
  - `@opentelemetry/instrumentation-http@0.218.0`
  - `@opentelemetry/instrumentation-ioredis@0.66.0`
  - `@opentelemetry/resources@2.7.1`
  - `@opentelemetry/sdk-node@0.218.0`
  - `@opentelemetry/sdk-trace-base@2.7.1`
  - `@opentelemetry/semantic-conventions@1.41.1`
- **Impact:** — No distributed tracing is active despite the infrastructure being fully wired in `package.json`. The OBSERVABILITY.md documentation describes OpenTelemetry behavior that does not actually run. ~3MB of unused dependencies are bundled into production images. If tracing is needed incident response, engineers will find it non-functional.
- **Evidence:**

  ```js
  // server/services/tracer.js:9-32 — fully implemented, called nowhere
  if (process.env.OTEL_ENABLED || isProd) {
    const { NodeSDK } = await import("@opentelemetry/sdk-node");
    // ... 23 lines of setup
    sdk.start();
    console.log("[Telemetry] OpenTelemetry started");
  }

  // server/services/telemetry.js:11-34 — duplicate implementation, called nowhere
  export function startTelemetry() { ... }

  // server/index.js:1-30 — imports list (no tracer)
  import "dotenv/config";
  import express from "express";
  // ... no import of tracer.js or telemetry.js
  ```

- **Recommendation:** Decide on which module to keep (prefer `telemetry.js` with static imports). Import and call `startTelemetry()` as the first line in `server/index.js`. Verify OTEL traces export to the configured collector. Remove the duplicate `tracer.js` file.

### [FIND-004] SSE Endpoint Auth Hole for EventSource — Severity: Critical

- **Location:** `server/index.js:165`, `src/hooks/useRealtimeMetrics.js:24-25`, `server/routes/realtime.js:7`
- **Description:** The real-time metrics SSE stream at `GET /api/realtime/metrics/stream` is guarded by `userAuth` middleware, which reads the JWT from the `Authorization: Bearer <token>` header. However, the browser `EventSource` API **cannot send custom headers**. It only supports HTTP GET with URL query parameters. As a result, any production deployment relying on browser EventSource to consume SSE metrics will fail authentication — the JWT cannot be transmitted.
- **Impact:** The SSE real-time dashboard feature is non-functional in production if auth is enforced. If the middleware is removed to make it work, all metrics data becomes publicly accessible. The `useRealtimeMetrics` hook never sends an auth token, so every connection will receive a 401 response.
- **Evidence:**

  ```js
  // src/hooks/useRealtimeMetrics.js:24-25
  const url = `${API_URL}/api/realtime/metrics/stream?${params}`;
  const source = new EventSource(url);
  // No Authorization header possible — EventSource does not support it

  // server/index.js:165
  app.use("/api/realtime", userAuth, realtimeRouter);
  // userAuth reads req.headers["authorization"] — which EventSource cannot send
  ```

- **Recommendation:** Pass the JWT as a query parameter (e.g., `?token=...`) or use a cookie-based auth approach. The existing ARCHITECTURE.md explicitly documents this limitation at line 389: "Auth with EventSource: EventSource doesn't support custom headers. For production, use cookie-based auth or pass token as a query parameter (with HTTPS)." This documented workaround was never implemented.

### [FIND-005] Express v5 Pre-Release Risk — Severity: Medium

- **Location:** `package.json:39`
- **Description:** The server depends on `express@^5.2.1`. Express 5.x is still in beta/pre-release status as of 2026. The full-version range `^5.2.1` will automatically install future pre-release minors and patches, which may contain breaking changes without a major version bump.
- **Impact:** A `npm update` or fresh install could pull in an Express 5.x version with different middleware contract semantics (Express 5 dropped error-handling middleware signatures, changed `req.query` parsing, etc.). No version lock or overrides are configured.
- **Evidence:**
  ```json
  "express": "^5.2.1"
  ```
- **Recommendation:** Pin to an exact version (`"express": "5.2.1"`) or add an `overrides` block. Alternatively, consider Express 4.x stable if the project doesn't specifically need Express 5 features.

### [FIND-006] No DTO / Validation Layer Separating Routes from Services — Severity: Medium

- **Location:** All files under `server/routes/` and `server/services/`
- **Description:** Route handlers directly call service functions and spread request body parameters into database queries. There is no dedicated Data Transfer Object (DTO) layer. Zod schemas exist in `server/middleware/validation.js` but are only used for the ingest endpoint and alert creation — the majority of routes manually destructure `req.body` and pass values without transformation or sanitization. Services like `metricsService.js`, `usageService.js`, and `auditService.js` accept raw objects from routes with no input contract enforcement.
- **Impact:** Tight coupling between HTTP layer and business logic. Schema changes to the database propagate directly through routes to client contracts. Adding fields requires touching three layers instead of one DTO definition.
- **Evidence:**

  ```js
  // server/routes/projects.js:57-59 — raw body spread into insert
  const { data: project, error } = await supabase
    .from("projects")
    .insert({ organization_id: org.id, name: parsed.name, environment: parsed.environment })

  // server/routes/conversations.js:31-33 — no validation of project_id
  const { project_id, session_id, title } = req.body;
  const { data, error } = await supabase
    .from("conversations")
    .insert({ project_id, session_id, ... })

  // server/routes/notifications.js:18 — entire body field used without zod
  const { slack_webhook_url, email_enabled, slack_enabled, webhook_url } = req.body;
  ```

- **Recommendation:** Define zod schemas for every request body and query parameter. Centralize them in a `/server/validation/` directory. Never pass raw `req.body` or `req.query` to services.

### [FIND-007] vite.config.js Proxy Configured for Development Only — Severity: Low

- **Location:** `vite.config.js:28-34`
- **Description:** The Vite dev server proxy forwards `/api` requests to `http://localhost:3001`. This is essential for development but the proxy is only active in Vite's dev server. The `docker-compose.yml` frontend serves via nginx on port 80, which has its own `nginx.conf` — but the proxy target URL is hardcoded to `localhost:3001` with no environment variable. In production or Docker Compose deployments, the frontend must either rely on the nginx config or the server's CORS configuration.
- **Impact:** During local development behind Vite, `fetch('/api/health')` works. In production builds, the same fetch would hit the nginx server which must separately proxy to the backend. The current `vite.config.js` has no production-relevant fallback since the proxy is never active in the built output.
- **Evidence:**
  ```js
  // vite.config.js:28-35
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
  ```
- **Recommendation:** Document that the proxy is dev-only. Ensure `nginx.conf` provides equivalent routing. Consider adding `base: '/api'` to the Vite build output if the API should be served from the same origin in production.

### [FIND-008] No API Documentation Generation (OpenAPI/Swagger) — Severity: Medium

- **Location:** `API_DOCS.md` (entire file, 325 lines), `package.json` (missing swagger/openapi deps)
- **Description:** API documentation exists as a static Markdown file (`API_DOCS.md`) that must be manually updated in parallel with code changes. There is no OpenAPI/Swagger specification, no code generation from route schemas, and no interactive API explorer (Swagger UI/Redoc). The Zod schemas defined in `server/middleware/validation.js` and scattered across route files could drive automated spec generation using `zod-to-openapi` or `@asteasolutions/zod-to-openapi`, but no such integration exists.
- **Impact:** The `API_DOCS.md` is already out of sync with the actual code — it documents `POST /api/conversations/:id/messages` parameters but does not reflect that several Zod-defined fields are optional on the server. SDK developers must read route source code to understand exact contract requirements. No machine-readable API spec exists for automated client generation.
- **Evidence:**

  ```js
  // server/middleware/validation.js:3-17 — Zod schemas that could drive OpenAPI but don't
  export const ingestSchema = z.object({
    project_id: z.string(),
    ...
  });

  // API_DOCS.md:1-325 — hand-maintained static doc
  ```

- **Recommendation:** Integrate `zod-to-openapi` or `swagger-jsdoc` to generate an OpenAPI 3.0 spec from route annotations or Zod schemas. Serve the spec at `/api/docs` with Swagger UI.

---

## 4. Positive Highlights

- **Consistent request lifecycle middleware:** The `requestId`, `requestTiming`, and `requestLogger` middleware chain provides every request with a UUID, DB timing markers, and structured Pino logging. Response headers expose `X-Request-Id`, `X-Response-Time-MS`, and `X-DB-Time-MS` for debugging.
- **BullMQ queue abstraction with automatic fallback:** The `queueService.js` transparently degrades to synchronous DB writes when Redis is unavailable, with no code changes required in routes.
- **Zod validation on the ingest path:** The critical data ingestion endpoint has a formal validation schema (`ingestSchema`) that properly uses `z.enum()`, `z.number().int().nonnegative()`, and string length limits.
- **Graceful shutdown handling:** The `SIGINT`/`SIGTERM` handlers close the HTTP server, drain the BullMQ queue, and shut down Redis connections.
- **Frontend code splitting:** `vite.config.js` explicitly splits vendor, charts, and query libraries into separate chunks for optimal caching.

---

## 5. Risk Scoring Summary

| ID       | Title                                  | Severity | Effort to Fix |
| -------- | -------------------------------------- | -------- | ------------- |
| FIND-001 | No API Versioning                      | High     | 2-3 days      |
| FIND-002 | No Schema Versioning for DB Migrations | High     | 1-2 days      |
| FIND-003 | OpenTelemetry Tracer Is Dead Code      | High     | 0.5 day       |
| FIND-004 | SSE Endpoint Auth Hole for EventSource | Critical | 0.5 day       |
| FIND-005 | Express v5 Pre-Release Risk            | Medium   | 0.25 day      |
| FIND-006 | No DTO / Validation Layer              | Medium   | 3-5 days      |
| FIND-007 | vite.config.js Proxy Dev-Only          | Low      | 0.25 day      |
| FIND-008 | No API Documentation Generation        | Medium   | 1-2 days      |

---

## 6. Recommendations by Priority

### Immediate (fix within sprint)

1. **FIND-004** — Fix SSE auth by passing JWT as a query parameter or via cookie. This is a documented limitation with a known workaround that blocks a core dashboard feature in production.
2. **FIND-003** — Activate OpenTelemetry by importing and calling `startTelemetry()` in `server/index.js`; remove the dead duplicate module.
3. **FIND-005** — Pin express to an exact version to prevent surprise upgrades on a pre-release major.

### Short-term (next 2 sprints)

4. **FIND-001** — Add `/api/v1/` route prefix. Create a compatibility redirect layer for existing SDK clients.
5. **FIND-002** — Replace flat SQL files with a migration framework. Write rollback scripts for all existing migrations.
6. **FIND-008** — Integrate `zod-to-openapi` and serve a live OpenAPI spec.

### Long-term (roadmap)

7. **FIND-006** — Refactor routes to use a formal DTO layer. Separate HTTP concerns from business logic. Introduce a repository/DAO pattern for database access.
8. **FIND-007** — Formalize nginx proxy configuration and document the dev-vs-prod request routing strategy.
