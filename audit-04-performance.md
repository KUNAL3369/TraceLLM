# Audit Report: Frontend & Backend Performance

**Date:** 2026-05-28
**Auditor:** Production Audit Bot
**Severity Scale:** Critical / High / Medium / Low / Info

---

## 1. Executive Summary

The frontend application uses Vite 7 with React 19 and has several architectural strengths: route-level code splitting via `React.lazy()`, manual chunk splitting in the Vite config, and a `rollup-plugin-visualizer` bundle analysis tool. However, production builds ship without sourcemaps (`sourcemap: false`), making runtime error debugging in production nearly impossible. The SSE real-time metrics hook uses a naive fixed-delay reconnection strategy (3 seconds) that could hammer the server during extended outages.

On the backend, the chat endpoint has zero response caching, so identical prompts are recomputed against LLM providers on every request. The metrics service performs unbounded `SELECT *` queries on `inference_logs` — as the table grows, this becomes a memory exhaustion risk. React components make no use of `React.memo` or `useMemo` for render optimization, and the `useApi` hook fires on every endpoint string change without debounce. Docker images are generally well-structured for layer caching, but the frontend Dockerfile copies all source before running `npm run build`, invalidating the layer cache on any source change. Nginx serves assets without HTTP/2, brotli compression, or CDN integration.

## 2. Methodology

- `vite.config.js` and `package.json` reviewed for build tooling
- All React components and hooks in `src/` inspected for memoization, lazy loading, and debounce patterns
- SSE reconnection logic in `useRealtimeMetrics.js` reviewed
- `server/routes/chat.js`, `server/services/metricsService.js`, `server/services/failoverService.js` inspected for caching and timeout patterns
- `nginx.conf` reviewed for HTTP/2 and compression configuration
- Both `Dockerfile.frontend` and `Dockerfile.backend` reviewed for layer caching optimization
- Glob search for `src/assets/` — directory does not exist
- Component tree searched for `React.memo` and `useMemo` usage

## 3. Findings

### FIND-001: Sourcemaps Disabled in Production Build — Severity: High

- **Location:** `vite.config.js:26`
- **Description:** `sourcemap: false` in the Vite production config means minified bundle errors will produce unreadable stack traces pointing to mangled variable names and collapsed code. Without sourcemaps, Sentry or any error tracking service cannot map stack traces back to original source.
- **Impact:** Any production JavaScript error is virtually undebuggable. Developers must attempt to reproduce locally or deploy debug builds, wasting hours per incident.
- **Evidence:** `vite.config.js:26` — `sourcemap: false,`
- **Recommendation:** Set `sourcemap: true` (or `sourcemap: "hidden"` to avoid exposing sources in browser devtools). Consider using `sourcemap: "hidden"` in production, which generates `.map` files without the `//# sourceMappingURL` comment, keeping maps available for internal debugging only.

### FIND-002: No Provider Response Caching in Chat Endpoint — Severity: High

- **Location:** `server/routes/chat.js:6-54`
- **Description:** The `/api/chat` endpoint has no caching mechanism. Every request with identical messages, provider, and model triggers a new API call to the LLM provider. There is no in-memory cache (e.g., node-cache), no Redis cache, and no HTTP cache headers on the response.
- **Impact:** Identical requests (e.g., UI re-renders, duplicate messages, chat history review) are re-fetched from paid LLM providers, incurring unnecessary token costs and latency. There is no cache TTL or invalidation strategy.
- **Evidence:** `chat.js:23-47` — each request calls `adapter.chat()` or `adapter.streamChat()` directly without checking any cache. No `Cache-Control` headers on responses (line 43 uses `res.json()` with no cache headers).
- **Recommendation:** Implement a two-tier cache: (1) in-memory LRU cache for identical recent requests with TTL, (2) Redis-based cache for session replay. Key by `(provider, model, messages_hash)`.

### FIND-003: SSE Reconnection Uses Fixed Delay, No Exponential Backoff — Severity: Medium

- **Location:** `src/hooks/useRealtimeMetrics.js:56`
- **Description:** When the EventSource connection drops, the `onerror` handler waits exactly 3 seconds before reconnecting. There is no exponential backoff, no jitter, and no maximum retry limit. If the server is down for an extended period, the client will reconnect every 3 seconds indefinitely.
- **Impact:** During a server outage, all connected clients collectively hammer the server with reconnection attempts every 3 seconds, potentially preventing recovery. No backpressure mechanism exists.
- **Evidence:** `useRealtimeMetrics.js:56` — `reconnectRef.current = setTimeout(connect, 3000);` — fixed 3000ms delay. No backoff calculation or max retry check.
- **Recommendation:** Implement exponential backoff with jitter: `Math.min(1000 * Math.pow(2, attempt) + Math.random() * 1000, 30000)` with a maximum of 30 seconds and a retry cap (e.g., 10 attempts before giving up or showing a persistent error UI).

### FIND-004: No Database Query Batching in Service Layer — Severity: Medium

- **Location:** `server/services/metricsService.js:5-11`, `server/services/alertEvaluator.js:129-141`
- **Description:** `getMetrics()` performs an unbounded `SELECT *` on `inference_logs` without pagination or limits, loading all matching rows into application memory. The alert evaluator and metrics broadcast cron loop iterate over alerts/projects individually, issuing separate queries for each.
- **Impact:** A project with 1 million inference logs will trigger `getMetrics()` to load all 1M rows into memory. Repeated N+1 queries in alert evaluation degrade database performance under load.
- **Evidence:** `metricsService.js:5` — `supabase.from("inference_logs").select("*")` — no `.limit()`, no `.range()`. `server/index.js:193` — `for (const project of projects) { const data = await getMetrics(...); }` — N queries for N projects.
- **Recommendation:** (1) Rewrite `getMetrics()` to use aggregate queries (`.select("status, count(*)")`) instead of fetching all rows. (2) Batch alert evaluation into a single database operation. (3) Parallelize the metrics broadcast loop with `Promise.all` and add concurrency limits.

### FIND-005: No Debounce or Throttle in API Polling — Severity: Medium

- **Location:** `src/hooks/useApi.js:33-35`
- **Description:** The `useApi` hook fires a fetch request immediately whenever the `endpoint` string dependency changes. Combined with fast state changes (e.g., rapid project selector changes in Sidebar), this can trigger multiple concurrent API calls. There is no debounce, throttle, or request deduplication.
- **Impact:** Rapid project switching or component re-renders can fire 5-10 concurrent API requests. On the server side, each triggers a full metrics computation. Combined with FIND-004, this compounds database load.
- **Evidence:** `useApi.js:33-34` — `useEffect(() => { fetchData(); }, [endpoint]);` — no debounce wrapper. No AbortController on re-fetch (stale responses may overwrite newer data).
- **Recommendation:** Add `AbortController` to cancel in-flight requests on re-fetch. Consider `@tanstack/react-query`'s built-in deduplication (already imported in `package.json:32` but `useApi` does not use it — it uses raw `useEffect`).

### FIND-006: No `React.memo` or `useMemo` Usage — Severity: Low

- **Location:** All components in `src/pages/`, `src/components/`
- **Description:** Systematic audit of all React components found zero uses of `React.memo`, zero uses of `useMemo`, and only one `useCallback` usage (`Chat.jsx:109`). Components like `MetricCard`, `StatusDot`, `Sidebar`, and `Dashboard` re-render on every parent state change regardless of whether their props changed.
- **Impact:** Unnecessary re-renders on the dashboard (which re-renders every 10 seconds via SSE) degrade UI responsiveness, especially on lower-end devices. The `MetricCard` component (`MetricCard.jsx:1`), rendered 12+ times on the dashboard, has no memoization.
- **Evidence:** `MetricCard.jsx:1` — no `React.memo` wrapper. `Sidebar.jsx:18` — no memo. `Dashboard.jsx:24` — entire page re-renders on every SSE metrics update. Only `Chat.jsx:109` uses `useCallback` for `sendMessage`.
- **Recommendation:** Wrap pure presentational components (`MetricCard`, `StatusDot`, `MetricCardSkeleton`, `EmptyState`) in `React.memo`. Memoize expensive derivations in `Dashboard` with `useMemo` (e.g., `summary`, `trends`, `providers` derivations).

### FIND-007: No HTTP/2 or Brotli Compression in Nginx — Severity: Medium

- **Location:** `nginx.conf:1-20`
- **Description:** The nginx configuration serves static assets over HTTP/1.1 with no HTTP/2 enabled and no brotli compression configured (only implicit gzip). HTTP/2 provides multiplexed streams, server push, and header compression that significantly improves load times for SPAs with many small chunks.
- **Impact:** Slower page loads, especially for the initial bundle download. With manual chunking producing 4+ JS chunks (`vendor`, `charts`, `query`, main), HTTP/1.1 connection limits force sequential downloads. No brotli means 20-30% larger asset transfer sizes compared to brotli.
- **Evidence:** `nginx.conf:2` — `listen 80;` — no `http2` parameter. No `brotli` directives present anywhere in the file.
- **Recommendation:** Change to `listen 80 http2;` (or `listen 443 ssl http2;` for HTTPS). Install `ngx_brotli` module and add `brotli on; brotli_types text/css application/javascript application/json;`.

### FIND-008: No CDN or Asset Base Path Configuration — Severity: Low

- **Location:** `vite.config.js:5-27`
- **Description:** The Vite config does not set a `base` path, meaning assets are served from the root (`/`). There is no CDN integration for static assets, no `--base` override for different environments, and no asset hash configuration beyond Vite's default content-hash filenames.
- **Impact:** All assets are served from the single nginx origin. No CDN edge caching for global users. Bypassing a CDN means no geographic distribution, no DDoS mitigation for static assets, and higher latency for non-local users.
- **Evidence:** `vite.config.js:5-27` — no `base` property set. No environment-specific base URL configuration.
- **Recommendation:** Set `base: process.env.VITE_CDN_URL || '/'` in `vite.config.js`. Configure a CDN (CloudFront, Cloudflare, etc.) to serve the `dist/` directory with long cache headers.

### FIND-009: Frontend Docker Image Copies Source Before Build — Severity: Low

- **Location:** `Dockerfile.frontend:4-6`
- **Description:** The Dockerfile copies `package*.json`, runs `npm ci`, then copies ALL source with `COPY . .` (line 5) before running `npm run build` (line 6). While the dependency installation layer is correctly cached, the `COPY . .` instruction copies everything including tests, config files, and documentation that are unnecessary at runtime. More importantly, any source change invalidates the `COPY . .` layer but not the `RUN npm ci` layer, which is correct. However, there is no `.dockerignore` to exclude `node_modules`, `src/test/`, and other artifacts.
- **Impact:** Unnecessary build context increases image size and build time. Without a `.dockerignore`, the `COPY . .` may include `node_modules` from the host, potentially overwriting the clean `npm ci` install. The production nginx image in the second stage is clean.
- **Evidence:** `Dockerfile.frontend:4-6` — `COPY package*.json ./` → `RUN npm ci` → `COPY . .` → `RUN npm run build`. No `.dockerignore` file was found.
- **Recommendation:** Add a `.dockerignore` excluding `node_modules`, `src/test`, `.git`, `*.md`, `.env*`. Optionally use a more specific `COPY` (e.g., `COPY src/ src/`, `COPY index.html .`, etc.) instead of `COPY . .`.

### FIND-010: Backend Docker Layer Cache Suboptimal for `server/` — Severity: Info

- **Location:** `Dockerfile.backend:3-5`
- **Description:** The backend Dockerfile copies `package*.json` and runs `npm ci --omit=dev`, then copies only `server/` directory — which is good. However, if `server/` changes but `package*.json` does not, the `npm ci` layer is correctly cached. But the `COPY server/ server/` instruction (line 5) has no `.dockerignore` and copies everything including `node_modules` if present on the host.
- **Impact:** Minor — the overall multi-stage structure is correct. The main risk is from missing `.dockerignore`.
- **Evidence:** `Dockerfile.backend:5` — `COPY server/ server/`. No `.dockerignore` in repository.
- **Recommendation:** Create a `.dockerignore` file excluding `node_modules`, `.git`, and test artifacts. This applies to both Dockerfiles.

## 4. Positive Highlights

- **Lazy loading is correctly implemented:** All 11 page components in `App.jsx:9-19` use `React.lazy()` with `<Suspense>`, ensuring routes are code-split at the page level.
- **Manual chunk splitting configured:** `vite.config.js:18-22` splits `vendor` (React ecosystem), `charts` (recharts), and `query` (@tanstack/react-query) into separate chunks, improving cache efficiency.
- **Bundle analysis tool present:** `rollup-plugin-visualizer` is configured in `vite.config.js:8-13` with gzip and brotli size reporting, accessible via `npm run build:analyze`.
- **React Query configured:** `@tanstack/react-query` with `staleTime: 60000` and `gcTime: 300000` is set up in `App.jsx:21-29`, though not fully utilized across all data-fetching hooks.
- **Queued ingestion with backpressure:** `queueService.js` uses BullMQ with Redis, providing exponential backoff, concurrency limiting (5 workers), rate limiting (50/s), and a dead-letter queue for failed jobs.
- **Request timing middleware:** `requestTiming.js` tracks total response time and DB time per request, exposing `X-Response-Time-MS` and `X-DB-Time-MS` headers.
- **Virtual list hook available:** `useVirtualList.js` provides performant windowed rendering for large lists.
- **Docker multi-stage build:** Frontend Dockerfile uses a multi-stage build with `node:20-alpine` for building and `nginx:alpine` for serving.

## 5. Risk Scoring Summary

| ID       | Title                                   | Severity | Effort to Fix |
| -------- | --------------------------------------- | -------- | ------------- |
| FIND-001 | Sourcemaps Disabled in Production Build | High     | 5 min         |
| FIND-002 | No Provider Response Caching            | High     | 2-3 days      |
| FIND-003 | SSE Fixed Reconnection Delay            | Medium   | 1 hour        |
| FIND-004 | No Database Query Batching              | Medium   | 2-3 days      |
| FIND-005 | No Debounce/Throttle in API Polling     | Medium   | 1 day         |
| FIND-006 | No React.memo or useMemo Usage          | Low      | 2-3 days      |
| FIND-007 | No HTTP/2 or Brotli in Nginx            | Medium   | 1 day         |
| FIND-008 | No CDN Asset Base Path                  | Low      | 1 day         |
| FIND-009 | Frontend Docker Copy Optimization       | Low      | 30 min        |
| FIND-010 | Missing .dockerignore                   | Info     | 15 min        |

## 6. Recommendations by Priority

### Immediate (fix within sprint)

- **FIND-001:** Enable `sourcemap: "hidden"` in `vite.config.js` for production debugging
- **FIND-003:** Implement exponential backoff with jitter in `useRealtimeMetrics.js`
- **FIND-005:** Add `AbortController` to `useApi.js` and switch to React Query for deduplication
- **FIND-010:** Create a `.dockerignore` file excluding `node_modules`, `.git`, `*.md`

### Short-term (next 2 sprints)

- **FIND-002:** Implement in-memory LRU cache for chat responses with configurable TTL
- **FIND-004:** Rewrite `getMetrics()` to use aggregate queries instead of `SELECT *`
- **FIND-007:** Enable HTTP/2 in `nginx.conf` and configure brotli compression
- **FIND-006:** Add `React.memo` to `MetricCard`, `StatusDot`, `Sidebar` navigation items

### Long-term (roadmap)

- **FIND-008:** Deploy static assets to CDN and configure `base` path in Vite
- **FIND-009:** Optimize Docker build context with specific COPY instructions
