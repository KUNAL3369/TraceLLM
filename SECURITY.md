# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| 2.x     | ✅ Active |
| 1.x     | ❌ End of life |

## Authentication

TraceLLM uses two authentication mechanisms:

- **User Auth**: Supabase JWT-based session auth for all dashboard routes. Tokens are validated server-side via `supabase.auth.getUser()`.
- **API Key Auth**: SHA-256 hashed API keys for the ingestion endpoint (`/api/ingest`). Keys are stored as hashes only — never in plaintext.

## Security Headers

Helmet is configured with strict CSP:

- `default-src: 'self'`
- `script-src: 'self'` (production)
- `style-src: 'self' 'unsafe-inline'`
- `connect-src: 'self' <frontend_url> <supabase_url> <provider_apis>`
- `object-src: 'none'`
- `frame-src: 'none'`
- CSP violation reports sent to `/api/csp-report`

## Data Protection

- **PII Redaction**: 7 regex patterns (emails, phones, CCs, API keys, tokens, passwords, JWTs) applied to request/response previews when enabled
- **Tenant Isolation**: Row-Level Security on all 12+ tables ensures cross-tenant data isolation at the database level
- **Audit Logging**: All mutating actions logged with user ID, IP address, and request ID

## Rate Limiting

- General API: 100 requests/minute per IP
- Ingestion API: 300 requests/minute per API key

## Reporting a Vulnerability

Open a [GitHub Security Advisory](https://github.com/KUNAL3369/TraceLLM/security/advisories) or email the maintainers directly.
