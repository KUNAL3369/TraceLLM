# Audit Report: Database Schema & Query Patterns

**Date:** 2026-05-28
**Auditor:** Production Audit Bot
**Severity Scale:** Critical / High / Medium / Low / Info

---

## 1. Executive Summary

The database layer uses Supabase (PostgreSQL) accessed directly via `@supabase/supabase-js` without an ORM or query builder. Schema is defined across three raw SQL files (`schema.sql`, `migration_v2.sql`, `migration_v3.sql`) that are applied manually in the Supabase SQL editor — there is no automated migration runner, no version tracking table, and no rollback capability. This creates a fragile deployment process where schema drift between environments is likely.

While the schema has a reasonable set of indexes on the core `inference_logs` table, several supporting tables lack indexes on frequently queried columns. The absence of `updated_at` triggers means timestamp columns annotated as `default now()` are never refreshed on row updates, silently producing stale metadata. No soft-delete columns exist anywhere in the schema, making accidental data loss permanent. Multiple service files exhibit N+1 query patterns and SELECT-then-UPSERT race conditions that will cause failures under concurrent load.

## 2. Methodology

- All three SQL schema/migration files read in full
- Every service file in `server/services/` inspected for query patterns
- All route files in `server/routes/` inspected for query patterns
- `package.json` checked for query builder or migration dependencies
- Index definitions enumerated across all tables
- Trigger and function definitions reviewed
- RLS policy structure reviewed

## 3. Findings

### FIND-001: No Automated Migration Framework — Severity: Critical

- **Location:** `server/db/schema.sql`, `server/db/migration_v2.sql`, `server/db/migration_v3.sql`
- **Description:** Schema is managed via raw `.sql` files with instructions to "Run this in your Supabase SQL editor." There is no migration runner (Knex, node-pg-migrate, or similar). `package.json` confirms no migration library is installed. Files use sequential naming (`schema.sql` → `migration_v2.sql` → `migration_v3.sql`) rather than timestamp-based ordering, making it impossible to determine execution order across branches or team members.
- **Impact:** Deployment requires manual SQL execution. No rollback capability. Schema drift between environments is guaranteed over time. Team members cannot apply migrations in a consistent order.
- **Evidence:** `package.json:1-85` — no migration library in dependencies. File naming is hand-rolled `migration_v2.sql`, `migration_v3.sql` without timestamps.
- **Recommendation:** Adopt Knex.js or node-pg-migrate with timestamp-based migration files (e.g., `20260528000001_add_pii_column.sql`). Add a `migrations` tracking table.

### FIND-002: Missing Index on `conversations.session_id` — Severity: High

- **Location:** `server/db/schema.sql:39`
- **Description:** The `conversations` table has no index on `session_id`, despite this column being used for session-based lookups. The `inference_logs` table similarly has no index on `session_id`, though it is queried in `metricsService.js` line 26 via `data.filter((r) => r.session_id)` (client-side filtering, which would be server-side in production). Only `project_id` and `status` are indexed on `conversations`.
- **Impact:** Any query filtering conversations by `session_id` will perform a sequential scan. As conversation volume grows, this becomes a performance bottleneck.
- **Evidence:** `schema.sql:86-88` shows only `idx_conversations_project_id` and `idx_conversations_status`. No `idx_conversations_session_id` exists.
- **Recommendation:** `CREATE INDEX IF NOT EXISTS idx_conversations_session_id ON conversations(session_id);`

### FIND-003: No `updated_at` Auto-Update Triggers — Severity: Medium

- **Location:** `server/db/migration_v2.sql:19`, `migration_v2.sql:42`, `migration_v2.sql:55`, `migration_v3.sql:73`, `migration_v3.sql:84`
- **Description:** Multiple tables define an `updated_at` column with `default now()`, but there is no PostgreSQL trigger to automatically update this column on row modification. Tables affected: `alerts`, `notification_settings`, `subscriptions`, `usage_quotas`, `daily_usage`. Only `daily_usage.updated_at` is manually set in application code (`quotaService.js:25`).
- **Impact:** `updated_at` columns on `alerts`, `notification_settings`, `subscriptions`, and `usage_quotas` will remain at their creation timestamp indefinitely, making it impossible to detect when configurations were last modified.
- **Evidence:** No `CREATE OR REPLACE FUNCTION update_updated_at_column()` function exists in any migration file. The only trigger functions defined are `handle_new_user()` and `handle_new_organization()`, which handle insertion logic only.
- **Recommendation:** Create a generic `update_updated_at_column()` trigger function and apply it to all tables with `updated_at` columns.

### FIND-004: No Soft-Delete Strategy — Severity: Medium

- **Location:** `server/db/schema.sql`, `migration_v2.sql`, `migration_v3.sql`
- **Description:** No table in the schema includes a `deleted_at` timestamp column. All deletions use PostgreSQL `ON DELETE CASCADE` (e.g., `schema.sql:17`, `schema.sql:27`, `schema.sql:38`, `migration_v2.sql:10`). This means deleting an organization, project, or API key is permanent and irrecoverable.
- **Impact:** Accidental deletion of an organization cascades to delete all projects, API keys, conversations, messages, and inference logs with no recovery path. No audit trail exists for deletions.
- **Evidence:** All 18 tables in the schema were inspected. Zero have a `deleted_at` column. All foreign key constraints use `ON DELETE CASCADE`.
- **Recommendation:** Add `deleted_at timestamptz` to all core tables. Update RLS policies to filter `WHERE deleted_at IS NULL`. Replace hard deletes with `UPDATE ... SET deleted_at = now()`.

### FIND-005: No Connection Pooling Configuration — Severity: Medium

- **Location:** `server/db/supabase.js:4-12`
- **Description:** The Supabase client is initialized with no connection pooling parameters. The `createClient` call passes only URL and key — no pooling config, no connection timeout, no idle timeout. Supabase's JS client uses a single HTTP connection pool under the hood, but without explicit configuration, every server instance creates its own pool with default limits.
- **Impact:** Under load, the default pool (typically 1-3 concurrent connections per instance) will queue requests. Multiple server instances compound the issue with uncoordinated pools. No connection limits or circuit breakers are configured.
- **Evidence:** `server/db/supabase.js:12` — `export const supabase = createClient(supabaseUrl, supabaseKey);` — no third argument with `{ db: { pool: {...} } }` or similar configuration.
- **Recommendation:** Configure pool settings: `createClient(supabaseUrl, supabaseKey, { db: { pool: { min: 2, max: 10 } } })`. Add connection timeout handling.

### FIND-006: SELECT-then-UPSERT Race Condition — Severity: High

- **Location:** `server/services/usageService.js:8-14`, `server/services/quotaService.js:12-17`
- **Description:** Both `trackUsage()` and `trackDailyUsage()` follow a SELECT-first-then-UPDATE-or-INSERT pattern in separate queries. Between the SELECT and the subsequent write, another concurrent request can create or modify the same row, causing duplicate rows (INSERT path) or lost updates (UPDATE path with stale data).
- **Impact:** Under concurrent ingestion (>1 request/ms), usage counters will be inaccurate — either double-counting or dropping counts entirely. This directly affects billing accuracy and quota enforcement.
- **Evidence:** `usageService.js:8-14` — SELECT, then line 16 checks `if (existing)`, then line 17-24 UPDATE or line 26-33 INSERT. Same pattern in `quotaService.js:12-17`.
- **Recommendation:** Use PostgreSQL `INSERT ... ON CONFLICT DO UPDATE` (upsert) in a single query. Supabase RPC can wrap this. Example: `INSERT INTO daily_usage (...) VALUES (...) ON CONFLICT (project_id, date) DO UPDATE SET requests_count = daily_usage.requests_count + 1, tokens_count = daily_usage.tokens_count + $2;`

### FIND-007: N+1 Query Pattern in Alert Evaluation — Severity: High

- **Location:** `server/services/alertEvaluator.js:129-141`, `server/index.js:193-197`
- **Description:** `evaluateAllAlerts()` fetches all active alerts in one query (line 129-132), then iterates with `for...of` calling `evaluateAlert()` for each alert. Each `evaluateAlert()` call makes 3-5 additional database queries (getMetrics, getProjectName, getNotificationSettings, getOrganizationOwners, insert alert_event). Similarly, the 10-second metrics broadcast in `server/index.js:191-197` fetches up to 50 projects, then loops calling `getMetrics()` per project — and `getMetrics()` selects ALL rows from `inference_logs` for that project without pagination.
- **Impact:** With 100 active alerts and 50 projects, a single evaluation cycle can generate 300-500 database queries. The `getMetrics()` function (`metricsService.js:5`) uses `select("*")` with no pagination, pulling potentially millions of rows into application memory.
- **Evidence:** `alertEvaluator.js:129-132` — fetches all alerts, then `alertEvaluator.js:139-141` — `for (const alert of alerts) { await evaluateAlert(alert); }`. `metricsService.js:5` — `let query = supabase.from("inference_logs").select("*")` with no `.limit()`.
- **Recommendation:** Batch alert evaluation into a single SQL query using window functions or Supabase RPC. Add `.limit(10000)` to `getMetrics()` and use aggregate queries instead of fetching all rows.

### FIND-008: No Data Archival/Retention Strategy — Severity: Medium

- **Location:** All migration files and service files
- **Description:** There is no mechanism for archiving or purging old inference logs, audit logs, alert events, or webhook deliveries. The `inference_logs` table is the largest table and is queried without date bounds in `metricsService.js:5` when no `startDate`/`endDate` is provided. No cron job, TTL policy, or partitioning strategy exists.
- **Impact:** The `inference_logs` table grows unbounded. Over months, query performance degrades as every metrics query must scan more data. Storage costs increase linearly. Supabase has row limits on free/paid plans.
- **Evidence:** No `DELETE` statements exist in any service file for old data. No partitioning by `created_at`. No `pg_cron` or application-level cleanup job.
- **Recommendation:** Implement a retention policy: add a cron job to delete or archive inference logs older than N days (e.g., 90 days for pro plan, 30 days for free). Use PostgreSQL table partitioning by `created_at` for efficient pruning.

### FIND-009: No Direct Query Builder or Type Safety — Severity: Low

- **Location:** `server/db/supabase.js`, all service files
- **Description:** The codebase uses direct Supabase client queries without a typed query builder. Column names are hardcoded as strings throughout service files (e.g., `"pii_redaction_enabled"` in `ingest.js:53`, `"last_activity_at"` in `conversations.js:84`). There is no generated TypeScript or Zod schema matching the database schema, so column renames or type changes in migrations will not be caught at compile time.
- **Impact:** Schema-drift bugs are silent until runtime. Renaming a column in a migration requires manually finding and updating every string reference.
- **Evidence:** `ingest.js:53` — `.select("pii_redaction_enabled")`. `conversations.js:84` — `.update({ last_activity_at: new Date().toISOString() })`. Multiple hardcoded column strings throughout.
- **Recommendation:** Generate typed Supabase clients (via `supabase gen types`) or maintain Zod schemas that mirror the database schema and use them in all service files.

### FIND-010: Inefficient `provider_failover` Query in Hot Path — Severity: Low

- **Location:** `server/services/failoverService.js:73-80`
- **Description:** `getFailoverConfig()` performs a dynamic `import("../db/supabase.js")` on every call (line 74), rather than importing at module top level. This adds unnecessary latency to every failover lookup.
- **Impact:** Each failover configuration lookup incurs dynamic import overhead. In a rapid failover scenario (multiple providers failing), this compounds latency.
- **Evidence:** `failoverService.js:74` — `const { supabase } = await import("../db/supabase.js");` — dynamic import instead of static import.
- **Recommendation:** Replace with a static import at the top of the file: `import { supabase } from "../db/supabase.js";`

## 4. Positive Highlights

- Comprehensive indexing strategy on `inference_logs` — 9 indexes covering project_id, created_at, status, provider, model, error_type, latency_ms, total_tokens, and composite (project_id, created_at).
- Well-structured RLS policies scoped by project ownership chain, ensuring multi-tenant data isolation.
- RBAC tables (`organization_members`, `role_permissions`) with seeded default permissions provide a strong foundation for access control.
- Audit logging infrastructure (`audit_logs` table with `ip_address`, `request_id`) captures security-relevant events.
- Webhook delivery retry logic (`webhook_deliveries` table with `next_retry_at`, `attempt_count`, partial index on retryable status) is well-designed.
- Unique constraints on `usage_quotas(project_id)` and `daily_usage(project_id, date)` prevent duplicate usage records.

## 5. Risk Scoring Summary

| ID       | Title                                       | Severity | Effort to Fix |
| -------- | ------------------------------------------- | -------- | ------------- |
| FIND-001 | No Automated Migration Framework            | Critical | 2-3 days      |
| FIND-002 | Missing Index on `conversations.session_id` | High     | 30 min        |
| FIND-003 | No `updated_at` Auto-Update Triggers        | Medium   | 1 day         |
| FIND-004 | No Soft-Delete Strategy                     | Medium   | 2-3 days      |
| FIND-005 | No Connection Pooling Configuration         | Medium   | 1 day         |
| FIND-006 | SELECT-then-UPSERT Race Condition           | High     | 4 hours       |
| FIND-007 | N+1 Query Pattern in Alert Evaluation       | High     | 1-2 days      |
| FIND-008 | No Data Archival/Retention Strategy         | Medium   | 2-3 days      |
| FIND-009 | No Direct Query Builder or Type Safety      | Low      | 3-5 days      |
| FIND-010 | Inefficient provider_failover Import        | Low      | 15 min        |

## 6. Recommendations by Priority

### Immediate (fix within sprint)

- **FIND-002:** Add missing index on `conversations.session_id`
- **FIND-006:** Rewrite `trackUsage()` and `trackDailyUsage()` to use single UPSERT queries
- **FIND-010:** Convert dynamic import to static import in `failoverService.js`
- **FIND-007:** Add `.limit()` to `getMetrics()` to prevent unbounded row reads

### Short-term (next 2 sprints)

- **FIND-001:** Install Knex.js and convert all SQL files to timestamped, reversible migrations
- **FIND-005:** Add connection pooling configuration to Supabase client
- **FIND-003:** Add `updated_at` trigger function to all applicable tables
- **FIND-004:** Add `deleted_at` columns to core tables and update application code for soft deletes

### Long-term (roadmap)

- **FIND-008:** Implement data archiving with table partitioning and retention cron jobs
- **FIND-009:** Generate typed Supabase client or maintain matching Zod schemas
