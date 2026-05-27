# TraceLLM Security Audit

## Issues Found

### S-01: CORS wide open
- **Severity**: High
- **File**: `server/index.js:23`
- **Issue**: `app.use(cors())` allows any origin. In production, an attacker can make cross-origin requests from any domain.
- **Fix**: Restrict to frontend domain via `VITE_FRONTEND_URL` env var.

### S-02: Unauthenticated metrics endpoint
- **Severity**: High
- **File**: `server/index.js:47`
- **Issue**: `app.use("/api/metrics", metricsRouter)` has no `userAuth` middleware. Anyone can query metrics without authentication.
- **Fix**: Add `userAuth` middleware.

### S-03: Unauthenticated chat endpoint
- **Severity**: High
- **File**: `server/index.js:49`
- **Issue**: `app.use("/api/chat", chatRouter)` has no auth middleware. Chat is open to unauthenticated requests.
- **Fix**: Add `userAuth` middleware.

### S-04: Unauthenticated provider-health endpoint
- **Severity**: Medium
- **File**: `server/index.js:55`
- **Issue**: `GET /api/provider-health` has no auth. Returns internal provider status and recent request data.
- **Fix**: Add `userAuth` middleware.

### S-05: Mock/fallback metrics leak fake data
- **Severity**: Medium
- **File**: `server/routes/metrics.js:16-73`
- **Issue**: When no real data exists, the endpoint returns randomized mock data. This is misleading in production and could expose internal structure.
- **Fix**: Return empty/null data instead of mock data.

### S-06: No request logging
- **Severity**: Medium
- **File**: `server/index.js`
- **Issue**: No structured request logging. Cannot audit API usage or debug production issues.
- **Fix**: Add `morgan` middleware.

### S-07: No security headers
- **Severity**: Medium
- **File**: `server/index.js`
- **Issue**: No `helmet` middleware. Missing security headers like X-Content-Type-Options, X-Frame-Options, CSP.
- **Fix**: Add `helmet` middleware.

### S-08: No frontend error boundary
- **Severity**: Low
- **File**: `src/app/App.jsx`
- **Issue**: No React Error Boundary. Unhandled errors crash the entire UI with a white screen.
- **Fix**: Add ErrorBoundary component wrapping the app.

### S-09: Server uses VITE-prefixed env var
- **Severity**: Low
- **File**: `server/db/supabase.js:4`
- **Issue**: `VITE_SUPABASE_URL` is Vite's client-exposed prefix. Using it server-side is confusing and could inadvertently expose the URL pattern differently.
- **Fix**: Use `SUPABASE_URL` (without VITE_ prefix) on the server, fall back to VITE_ variant for dev convenience.

### S-10: Imports after app.listen
- **Severity**: Low
- **File**: `server/index.js:109-112`
- **Issue**: `import` statements appear after `app.listen()` at the bottom of the file. ESM imports are hoisted, but this is misleading and unconventional.
- **Fix**: Move all imports to top of file.

### S-11: No env var startup validation
- **Severity**: Medium
- **File**: `server/index.js`
- **Issue**: Only Supabase credentials are validated at startup. Missing API keys, Redis URL, and other critical vars are not checked, leading to silent runtime failures.
- **Fix**: Add startup validation for required env vars.

### S-12: No CSP in frontend
- **Severity**: Low
- **File**: `index.html`
- **Issue**: No Content-Security-Policy meta tag or header. If an XSS vulnerability exists, an attacker can inject arbitrary scripts.
- **Fix**: Add CSP meta tag (mitigated by Vite's built-in hashing for static assets).
