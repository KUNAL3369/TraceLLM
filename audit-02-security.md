# Audit Report: Security

**Date:** 2026-05-28
**Auditor:** Production Audit Bot
**Severity Scale:** Critical / High / Medium / Low / Info

---

## 1. Executive Summary

This security audit of TraceLLM reveals a mixed posture. The server implements several good practices: API keys are stored as SHA-256 hashes (never plaintext), Row-Level Security is enabled on all 12 database tables, PII redaction covers 7 sensitive-data patterns, and CSP violation reports are collected. However, there are critical gaps in the deployment surface: hardcoded development-origin URLs in CORS and CSP configurations that would be deployed to production, 20+ `console.error()` calls that bypass the Pino structured-logging system, 12 empty `catch {}` blocks that silently swallow errors, a `csrf-csrf` dependency that is installed but never initialized, and an SSE endpoint whose browser client cannot authenticate at all.

The CSP configuration mixes `'unsafe-inline'` (allowed in development, conditionally empty in production for scripts) with `'unsafe-eval'` for scripts, reducing XSS protection. The rate limiter covers all routes at a single default of 100 req/min, with no route-specific differentiation for sensitive endpoints like auth. No input validation library is consistently applied — Zod is installed and used in 2 of 12 route files, leaving the remaining routes unvalidated.

---

## 2. Methodology

Files audited via direct source reading: `server/index.js`, all 12 route files, all 5 middleware files, `src/hooks/useRealtimeMetrics.js`, `src/pages/Chat.jsx`, `src/lib/sdk.js`, `src/stores/*.js`, `.env.example`, `docker-compose.yml`, and all 3 SQL migration files. Recursive grep was used to count every `console.log`/`.error`/`.warn` call and every empty `catch` block. The `package.json` was cross-referenced against actual `import` statements to identify unused dependencies.

---

## 3. Findings

### [FIND-001] Hardcoded Fallback URLs in CORS and CSP — Severity: Critical

- **Location:** `server/index.js:34,60-72,86-92`
- **Description:** When `VITE_FRONTEND_URL` and `APP_URL` are not set (likely in production if .env is misconfigured), the CORS origin and CSP `connect-src` fall back to `"http://localhost:5173"`. This means a production deployment with missing environment variables would inadvertently accept CORS requests from `localhost:5173` — a development origin that should never be trusted in production. Additionally, the CSP `scriptSrc` in non-production mode allows `'unsafe-inline'`, which would be active in production if `NODE_ENV` is not explicitly set to `"production"`.
- **Impact:** An attacker who can trick a user into visiting `http://localhost:5173` (or who compromises a dev dependency) could make authenticated API requests from that origin, bypassing CORS restrictions intended for production. The fallback also reveals internal network topology.
- **Evidence:**

  ```js
  // server/index.js:34
  const FRONTEND_URL =
    process.env.VITE_FRONTEND_URL ||
    process.env.APP_URL ||
    "http://localhost:5173";

  // server/index.js:60-62
  scriptSrc: ([
    "'self'",
    isProduction ? "" : "'unsafe-inline'",
    "'unsafe-eval'",
  ],
    // server/index.js:86-92
    app.use(
      cors({
        origin: FRONTEND_URL,
        credentials: true,
      }),
    ));
  ```

- **Recommendation:** Remove the hardcoded fallback. Use `process.env.FRONTEND_URL` only and crash at startup if it's not set in production. Never allow `'unsafe-inline'` — use a nonce-based CSP for inline scripts.

### [FIND-002] SSE Endpoint Cannot Authenticate from Browser — Severity: Critical

- **Location:** `server/index.js:165`, `server/routes/realtime.js:6-13`, `src/hooks/useRealtimeMetrics.js:24-25`
- **Description:** The SSE stream at `/api/realtime/metrics/stream` is protected by `userAuth` middleware, which reads the `Authorization` header. But the browser `EventSource` API cannot set custom headers. No alternative auth mechanism (query param token, cookie) is implemented. As a result, the SSE endpoint either grants unauthenticated access (if `userAuth` is removed) or rejects every legitimate browser client (as it stands). Metrics data — including project performance stats, token usage, and error rates — would be exposed if the auth guard were disabled for the SSE path.
- **Impact:** The real-time dashboard feature is currently broken in any deployment relying on browser EventSource. If someone removes the `userAuth` guard to make it work, all project metrics become publicly readable. This is the same finding as ARCH-FIND-004 but specifically viewed through a confidentiality lens — the data flows are unencrypted in transit between server and client for SSE (no obvious WSS or HTTPS upgrade).
- **Evidence:**
  ```js
  // src/hooks/useRealtimeMetrics.js:24-25
  const url = `${API_URL}/api/realtime/metrics/stream?${params}`;
  const source = new EventSource(url); // No auth header support
  ```
- **Recommendation:** Pass JWT as a URL query parameter (`?token=<jwt>`) exclusively for the SSE endpoint, with HTTPS enforcement. Consider also supporting cookie-based session auth as a fallback.

### [FIND-003] csrf-csrf Package Installed but Never Imported — Severity: High

- **Location:** `package.json:37`, `server/index.js:1-31` (imports), entire `server/` (grep for csrf)
- **Description:** The `csrf-csrf` package (`^4.0.3`) is a production dependency but is never imported or initialized anywhere in the server code. The only reference to CSRF is an `x-csrf-token` header listed in the CORS `allowedHeaders` array. There is no CSRF token generation, no double-submit cookie, no synchronizer token pattern — the allowed header is a no-op declaration without corresponding middleware.
- **Impact:** The application has no CSRF protection. An attacker who tricks an authenticated user's browser into making a cross-origin state-changing request (POST/PUT/DELETE) can execute actions on behalf of that user. This is particularly dangerous for the alert, project, and billing mutation endpoints.
- **Evidence:**
  ```json
  // package.json:37
  "csrf-csrf": "^4.0.3",
  ```
  ```js
  // server/index.js:90 — only mention of csrf anywhere in the codebase
  allowedHeaders: ["Content-Type", "Authorization", "x-api-key", "x-csrf-token"],
  ```
- **Recommendation:** Initialize `csrf-csrf` middleware and apply it to all state-changing routes. Generate a CSRF token endpoint and send tokens to the frontend. The `x-csrf-token` header is correctly listed for CORS but the server never validates it.

### [FIND-004] Empty catch {} Blocks Silent Error Swallowing — Severity: High

- **Location:** 12 locations across `server/` and `src/`
- **Description:** Twelve `catch {}` and `catch { // comment }` blocks silently swallow exceptions across the codebase. The most dangerous is in `server/index.js:132` where a Supabase query failure in the health check is caught silently — the `dbOk` variable stays `false` but no error is logged anywhere. In `server/routes/internal.js:53`, a failed database connection check is silently caught. The `server/routes/queue.js` catch blocks swallow all errors from BullMQ queue interactions.
- **Impact:** Operational blindness. Silent catches hide database connection failures, queue processing errors, and authentication failures. In production, engineers will see a "degraded" health status with no error log trail to investigate the root cause.
- **Evidence:**

  ```js
  // server/index.js:132-133 — health check DB failure silently ignored
  } catch {
    // DB check failed — respond with degraded status
  }

  // server/routes/internal.js:53-55 — DB connectivity check silent
  } catch {
    // supabase query failed
  }

  // server/routes/queue.js:31-33, 58-60, 69-71 — all queue errors swallowed
  } catch {
    res.status(500).json({ error: "Failed to get queue status" });
  }
  ```

- **Recommendation:** Every `catch` block must at minimum log the error via `logger.error()`. Remove bare `catch {}` blocks. Where a catch is intentionally empty (e.g., non-critical localStorage access in `themeStore.js`), it should have an explanatory comment and a `logger.debug()` call.

### [FIND-005] console.log / console.error Used Instead of Pino Logger (20+ Instances) — Severity: Medium

- **Location:** 23 locations in `server/`, 10 locations in `src/`
- **Description:** Despite having a fully configured Pino structured-logging service (`server/services/logger.js`), 20+ files use raw `console.error()` and `console.log()` calls for error reporting. The most critical are in `server/routes/chat.js:49`, `server/routes/metrics.js:22`, `server/routes/conversations.js:24,41,57,89`, `server/routes/projects.js:46,77,112,145`, `server/routes/alerts.js:61`, `server/services/metricsService.js:14`, and `server/services/alertEvaluator.js:124,135`. The `server/services/telemetry.js:33` even calls `console.error` from inside a `.catch()` on the OpenTelemetry shutdown.
- **Impact:** Unstructured log output cannot be parsed, filtered, or aggregated by production logging systems (DataDog, ELK, Grafana Loki). Error context from structured serializers (request ID, project ID, user ID) is lost. Pino's custom `req` and `res` serializers are bypassed entirely.
- **Evidence:**

  ```js
  // server/routes/chat.js:49 — console.error instead of logger.error
  console.error("Chat error:", err);

  // server/db/supabase.js:8 — startup error, not using logger
  console.error("Missing Supabase credentials in .env");

  // server/services/telemetry.js:33 — SDK shutdown error
  sdk.shutdown().catch(console.error);
  ```

- **Recommendation:** Replace every `console.error()` call with `logger.error({ err }, "descriptive message")`. Configure ESLint rule `no-console` with an `allow` list for `warn` only in development. Use `import { logger } from "../services/logger.js"` consistently.

### [FIND-006] SQL Injection Risk — Severity: Medium

- **Location:** `server/routes/notifications.js:22-28`, `server/routes/alerts.js:67-72`
- **Description:** Most database access uses Supabase's parameterized query builder, which is safe from SQL injection. However, two routes use raw `req.body` object spreads into Supabase `.update()` calls without any field allowlist. In `routes/alerts.js:67-72`, `req.body` is spread directly into `.update(req.body)` — an attacker could inject arbitrary column updates. In `routes/notifications.js:22-28`, `slack_webhook_url` and `webhook_url` are accepted directly without validation against a URL schema.
- **Impact:** An attacker who can reach these authenticated endpoints could potentially modify arbitrary columns in the `alerts` or `notification_settings` tables (e.g., setting `is_active=true` on all alerts, modifying `project_id` to cause cross-tenant data confusion).
- **Evidence:**

  ```js
  // server/routes/alerts.js:67-72 — req.body spread into update without field allowlist
  const { data, error } = await supabase
    .from("alerts")
    .update(req.body)
    .eq("id", req.params.id)

  // server/routes/notifications.js:18-28 — no URL validation on webhook_url
  const { slack_webhook_url, email_enabled, slack_enabled, webhook_url } = req.body;
  const { data, error } = await supabase
    .from("notification_settings")
    .upsert({ ..., slack_webhook_url: slack_webhook_url || null, webhook_url: webhook_url || null, ... })
  ```

- **Recommendation:** Never pass `req.body` directly to `.update()`. Destructure and allowlist the specific fields that can be updated. Validate URLs with a URL-parsing library or zod `z.string().url()`.

### [FIND-007] CSP 'unsafe-inline' in Production Path — Severity: Medium

- **Location:** `server/index.js:61-62`
- **Description:** The CSP `styleSrc` is always `"'unsafe-inline'"` even in production. The `scriptSrc` conditionally removes `'unsafe-inline'` in production but always keeps `'unsafe-eval'`. The `'unsafe-inline'` on styles means inline `<style>` tags and `style` attributes are permitted, which defeats an important XSS mitigation. The `'unsafe-eval'` on scripts allows `eval()` and similar dynamic code execution.
- **Impact:** If an XSS vulnerability exists (e.g., reflected XSS in a query parameter rendered in the dashboard), `'unsafe-inline'` on styles and `'unsafe-eval'` on scripts make it significantly easier for an attacker to execute malicious code. Modern CSP best practice uses nonces or hashes for inline styles and scripts.
- **Evidence:**
  ```js
  // server/index.js:60-63
  scriptSrc: ["'self'", isProduction ? "" : "'unsafe-inline'", "'unsafe-eval'"],
  styleSrc: ["'self'", "'unsafe-inline'"],
  ```
- **Recommendation:** Replace `'unsafe-inline'` with a nonce-based approach for both scripts and styles. Generate a cryptographic nonce per request and pass it to the templating layer (or generate it via a CSP middleware like `helmet`'s nonce support). Remove `'unsafe-eval'` unless dynamically generated code is absolutely required.

### [FIND-008] Rate Limiter Applied Uniformly, Auth Routes Unprotected — Severity: Medium

- **Location:** `server/index.js:106-123`
- **Description:** A single general rate limiter at 100 requests/minute per IP covers all `/api/*` routes. The ingest path gets an additional 300 req/min limiter. However, there is no separate rate limiter for authentication endpoints (login/register) — these are handled client-side via Supabase, not on this Express server, but the frontend pages `Login.jsx` and `Signup.jsx` exist and call Supabase directly. No server-side rate limiting exists for password reset or signup attempts. Additionally, the `trust proxy` setting at line 123 is set to `1` — this trusts the first proxy's IP, which is correct behind a single reverse proxy but would be incorrect behind a chain (e.g., CDN → nginx → app).
- **Impact:** Auth endpoints (even Supabase-called ones) have no server-side rate limiting on this application's infrastructure. Brute-force login attempts against the Supabase auth API can proceed without throttling. The rate limiter also applies uniformly to all routes, which means a burst on the health-check endpoint could inadvertently rate-limit alert creation.
- **Evidence:**
  ```js
  // server/index.js:106-112 — single general limiter
  const generalLimiter = rateLimit({
    windowMs: 60000,
    max: 100,
    message: { error: "Too many requests" },
  });
  // ...
  app.use("/api", generalLimiter); // covers auth too
  app.set("trust proxy", 1);
  ```
- **Recommendation:** Add a dedicated stricter rate limiter for auth-related endpoints (10 req/min per IP on login). Review `trust proxy` setting against the actual deployment proxy chain. Consider differentiating rate limits per route group (e.g., 30 req/min for mutating endpoints, 300 for read).

### [FIND-009] No helmet/security Headers Beyond Manual CSP — Severity: Medium

- **Location:** `server/index.js:56-84`
- **Description:** While `helmet` is imported and configured at line 4, the CSP configuration disables several important helmet defaults. `crossOriginEmbedderPolicy` is set to `false`, `crossOriginResourcePolicy` is set to `"cross-origin"`. Several default helmet headers (like `X-DNS-Prefetch-Control`, `X-Download-Options`, `Origin-Agent-Cluster`, `X-Permitted-Cross-Domain-Policies`) are implicitly enabled by helmet's defaults but are explicitly overwritten by the custom configuration. The `Strict-Transport-Security` (HSTS) header is not explicitly configured — helmet enables it by default with `max-age: 15552000`, but if the custom config overrides it, HSTS is lost.
- **Impact:** Missing or weakened security headers expose the application to clickjacking (if `X-Frame-Options` is not set, though `frameSrc: "'none'"` helps), MIME-type sniffing attacks, and lack of HSTS means HTTPS downgrade attacks are possible on first connection.
- **Evidence:**
  ```js
  // server/index.js:56-84
  app.use(helmet({
    contentSecurityPolicy: { ... },  // Custom CSP overrides helmet defaults
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" },
    // HSTS not explicitly configured — check if defaults are preserved
  }));
  ```
- **Recommendation:** Explicitly configure all security headers: add `strictTransportSecurity: { maxAge: 31536000, includeSubDomains: true, preload: true }`. Remove `crossOriginEmbedderPolicy: false` unless COEP is deliberately needed. Audit which helmet defaults are overridden and re-enable them where possible.

### [FIND-010] No Consistent Input Validation Library — Severity: Medium

- **Location:** `package.json:56`, `server/middleware/validation.js`, all route files
- **Description:** `zod@4.4.3` is installed as a dependency and is used in exactly 3 route files: `ingest.js`, `alerts.js`, and `projects.js` (partial — only for the create schema). The remaining 9 route files (`conversations.js`, `metrics.js`, `chat.js`, `billing.js`, `audit.js`, `notifications.js`, `realtime.js`, `queue.js`, `internal.js`) perform zero server-side input validation beyond simple truthiness checks like `if (!messages || !messages.length)`. String length limits, type coercion, and enum validation are absent. The `chatRequestSchema` in `validation.js` is defined but never imported or used in `chat.js`.
- **Impact:** Malformed or malicious input passes through to the database layer. A user can send a `project_id` of any shape, a `provider` string of arbitrary length, or a `latency_ms` value that is negative or non-numeric. The Supabase query builder will either error silently or produce unexpected results.
- **Evidence:**

  ```js
  // server/middleware/validation.js:19-30 — defined but never imported into chat.js
  export const chatRequestSchema = z.object({ ... });

  // server/routes/conversations.js:31 — no validation of project_id or session_id
  const { project_id, session_id, title } = req.body;

  // server/routes/billing.js:47 — manual string comparison instead of z.enum
  if (!["pro", "growth"].includes(plan)) {
    return res.status(400).json({ error: "Invalid plan" });
  }
  ```

- **Recommendation:** Import and apply Zod schemas in every route handler. Define a `validate(schema)` middleware factory:

  ```js
  const validate = (schema) => (req, res, next) => {
    try {
      req.body = schema.parse(req.body);
      next();
    } catch (err) {
      res.status(400).json({ error: err.errors });
    }
  };
  ```

  Apply it to all POST, PUT, and PATCH handlers.

---

## 4. Positive Highlights

- **API key storage:** Keys are SHA-256 hashed before storage (`server/middleware/apiKeyAuth.js:11`) and never logged or returned in plaintext. The raw key is displayed once at creation and then irrecoverable.
- **Row-Level Security:** All 12+ database tables have RLS enabled with policies scoped through the `organizations.owner_user_id` chain, providing defense-in-depth even if application auth is bypassed.
- **PII redaction:** Seven regex patterns cover emails, phones, credit cards, API keys, bearer tokens, passwords, and JWTs. Redaction is applied in both the direct-write path and the BullMQ worker.
- **CSP violation reporting:** The `/api/csp-report` endpoint collects CSP violations and logs them with the Pino logger (`server/index.js:145-148`), enabling monitoring of injection attempts.
- **Request ID on every response:** Every request gets a UUID via middleware (`server/middleware/requestId.js`) and is returned as the `X-Request-Id` header, enabling request tracing across logs.
- **Audit logging:** Mutating actions in alerts, billing, and projects call `logAudit()` which writes to the `audit_logs` table with user ID, action, and metadata.

---

## 5. Risk Scoring Summary

| ID       | Title                                          | Severity | Effort to Fix |
| -------- | ---------------------------------------------- | -------- | ------------- |
| FIND-001 | Hardcoded Fallback URLs in CORS and CSP        | Critical | 0.5 day       |
| FIND-002 | SSE Endpoint Cannot Authenticate from Browser  | Critical | 0.5 day       |
| FIND-003 | csrf-csrf Package Installed but Never Imported | High     | 1 day         |
| FIND-004 | Empty catch {} Blocks Silent Error Swallowing  | High     | 1 day         |
| FIND-005 | console.log Instead of Pino Logger             | Medium   | 1 day         |
| FIND-006 | SQL Injection Risk via req.body Spread         | Medium   | 0.5 day       |
| FIND-007 | CSP 'unsafe-inline' in Production Path         | Medium   | 1 day         |
| FIND-008 | Rate Limiter Uniform, Auth Routes Unprotected  | Medium   | 0.5 day       |
| FIND-009 | No helmet/security Headers Beyond Manual CSP   | Medium   | 0.25 day      |
| FIND-010 | No Consistent Input Validation Library         | Medium   | 2-3 days      |

---

## 6. Recommendations by Priority

### Immediate (fix within sprint)

1. **FIND-001** — Remove hardcoded `localhost` fallback. Validate `FRONTEND_URL` at startup in production.
2. **FIND-002** — Implement token-in-query-parameter auth for SSE endpoint. Document the HTTPS requirement.
3. **FIND-003** — Initialize `csrf-csrf` middleware on all state-changing routes. Expose a CSRF token endpoint.
4. **FIND-004** — Add `logger.error()` to every bare `catch` block. Audit all 12 locations within 1 sprint.

### Short-term (next 2 sprints)

5. **FIND-005** — Bulk-replace all `console.error()` calls with `logger.error()`. Add ESLint `no-console` rule.
6. **FIND-006** — Replace `req.body` spreads with field allowlists in `alerts.js` and `notifications.js`.
7. **FIND-007** — Replace `'unsafe-inline'` with a per-request nonce for both scripts and styles.
8. **FIND-008** — Add dedicated rate limiter for auth endpoints. Validate `trust proxy` setting against actual proxy chain.
9. **FIND-010** — Apply Zod schemas to all route handlers. Create a reusable `validate()` middleware factory.

### Long-term (roadmap)

10. **FIND-009** — Audit all helmet configuration for missing headers. Explicitly enable HSTS, `X-Content-Type-Options`, and `X-Frame-Options`.
