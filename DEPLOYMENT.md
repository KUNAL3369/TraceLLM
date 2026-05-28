# TraceLLM Deployment Guide

## Prerequisites

- Node.js 20+
- PostgreSQL via [Supabase](https://supabase.com)
- Redis (optional, for BullMQ queue)

## Environment Variables

Copy `.env.example` to `.env`:

```
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
GROQ_API_KEY=gsk_...
OPENROUTER_API_KEY=sk-or-...
REDIS_URL=redis://localhost:6379 (optional)
VITE_FRONTEND_URL=http://localhost:5173
VITE_API_URL=http://localhost:3001
```

## Local Development

```bash
# Terminal 1 — Backend
cd server
npm install
npm run dev

# Terminal 2 — Frontend
npm install
npm run dev
```

## Database Setup

1. Create a Supabase project
2. Run `server/db/migration_v2.sql` in the Supabase SQL editor
3. Enable the "Email" auth provider in Supabase dashboard
4. Copy service role key from Project Settings → API

## Docker

```bash
docker compose up --build
```

This starts three services:
- **frontend** (port 5173) — Vite dev server
- **backend** (port 3001) — Express API
- **redis** (port 6379) — BullMQ queue backend

## Production Build

### Frontend (Vercel/Netlify)

```bash
npm run build   # outputs to dist/
```

Set env vars in your hosting dashboard:
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_API_URL` — URL of your deployed backend

### Backend (Railway/Fly.io/DigitalOcean)

```bash
cd server
npm run start   # starts with node index.js
```

Required env vars:
- `SUPABASE_SERVICE_ROLE_KEY`
- `VITE_SUPABASE_URL`
- `VITE_FRONTEND_URL` — for CORS
- All provider API keys you want to support
- `PORT` (default 3001)

## Post-Deployment Checks

1. Hit `/api/health` — should return `{"status":"ok","database":"connected"}`
2. Sign up via the web UI — should redirect to dashboard
3. Send a test chat — should persist after refresh
4. Send an ingestion request — should appear in metrics

## Security Checklist

- [ ] `SUPABASE_SERVICE_ROLE_KEY` is set (not `VITE_SUPABASE_ANON_KEY`) for server auth
- [ ] `VITE_FRONTEND_URL` restricts CORS to your domain
- [ ] All `.env` values use real keys (no placeholders)
- [ ] Session RLS policies are active in Supabase
- [ ] API keys are rotated regularly
