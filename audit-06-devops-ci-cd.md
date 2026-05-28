# Audit Report: DevOps & CI/CD

**Date:** 2026-05-28
**Auditor:** Production Audit Bot
**Severity Scale:** Critical / High / Medium / Low / Info

---

## 1. Executive Summary

The TraceLLM project has a functional but incomplete DevOps posture. The CI pipeline (GitHub Actions) runs lint, test, build, and a basic security audit on every push and pull request. Docker support exists with a multi-stage frontend build and Docker Compose orchestration. Husky pre-commit hooks enforce lint-staged formatting, and a `.gitignore` file covers standard exclusions.

However, several critical gaps exist: the `Dockerfile.backend` runs the Node.js process as root (violating the principle of least privilege), neither Dockerfile includes a `HEALTHCHECK` instruction, and `docker-compose.yml` specifies no resource limits or environment-specific profiles. The CI pipeline lacks npm cache configuration despite `cache: 'npm'` being set (it uses the setup-node cache but does not persist `node_modules` across jobs), has no secrets scanning beyond a basic grep, and has no automated database migration step. There is no deploy workflow, no container image tagging strategy (all images are `:latest`), and `vite.config.js` sets `sourcemap: false`, which hinders production debugging. The `nginx.conf` has no upstream health checks or rate limiting on the API proxy.

## 2. Methodology

The audit was performed by reading the following files: `Dockerfile.backend`, `Dockerfile.frontend`, `docker-compose.yml`, `.github/workflows/ci.yml`, `.husky/pre-commit`, `.lintstagedrc.json`, `nginx.conf`, `eslint.config.js`, `vite.config.js`, `.gitignore`, `package.json`, `DEPLOYMENT.md`, and `CONTRIBUTING.md`. Grep searches were performed for `USER`, `HEALTHCHECK`, `deploy:`, `resources:`, `limits:`, `--import`, migration-related scripts, and deploy workflow patterns.

## 3. Findings

### [FIND-001] Dockerfile.backend Runs as Root — Severity: High

- **Location:** `Dockerfile.backend:1-7`
- **Description:** The backend Docker image uses `FROM node:20-alpine` and never adds a `USER` directive. The Node.js process runs as the root user inside the container. This is a violation of the principle of least privilege and container security best practices. If the Node.js process is compromised (e.g., via RCE in a dependency), an attacker gains root access to the container.
- **Impact:** Container breakouts are easier from a root-privileged process. Compliance frameworks (SOC 2, PCI-DSS, HIPAA) require non-root execution. Kubernetes Pod Security Standards (Restricted profile) reject containers running as root.
- **Evidence:**
  ```dockerfile
  # Dockerfile.backend (entire file — 7 lines)
  FROM node:20-alpine
  WORKDIR /app
  COPY package*.json ./
  RUN npm ci --omit=dev
  COPY server/ server/
  EXPOSE 3001
  CMD ["node", "server/index.js"]
  # No USER directive anywhere
  ```
- **Recommendation:** Add a non-root user before the `WORKDIR` instruction:
  ```dockerfile
  RUN addgroup -S appgroup && adduser -S appuser -G appgroup
  USER appuser
  ```

### [FIND-002] No HEALTHCHECK in Either Dockerfile — Severity: High

- **Location:** `Dockerfile.backend:1-7`, `Dockerfile.frontend:1-12`
- **Description:** Neither `Dockerfile.backend` nor `Dockerfile.frontend` includes a `HEALTHCHECK` instruction. Docker Compose orchestration and container orchestrators (Docker Swarm, Kubernetes) rely on health checks to determine container liveness. Without them, a backend that has deadlocked or is serving 500s from all endpoints will continue to receive traffic.
- **Impact:** Orchestrators cannot detect and restart unhealthy containers. A stuck backend process will serve errors to all users until manually detected. Zero-downtime deployments are not safely achievable.
- **Evidence:**

  ```dockerfile
  # Dockerfile.backend — no HEALTHCHECK
  FROM node:20-alpine
  WORKDIR /app
  # ...
  EXPOSE 3001
  CMD ["node", "server/index.js"]

  # Dockerfile.frontend — no HEALTHCHECK
  FROM nginx:alpine
  COPY --from=build /app/dist /usr/share/nginx/html
  COPY nginx.conf /etc/nginx/conf.d/default.conf
  EXPOSE 80
  CMD ["nginx", "-g", "daemon off;"]
  ```

- **Recommendation:** Add `HEALTHCHECK` to both Dockerfiles. For backend:
  ```dockerfile
  HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
    CMD node -e "fetch('http://localhost:3001/api/health').then(r => process.exit(r.ok?0:1)).catch(() => process.exit(1))"
  ```
  For frontend (nginx):
  ```dockerfile
  HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:80/ || exit 1
  ```

### [FIND-003] No Resource Limits in docker-compose.yml — Severity: High

- **Location:** `docker-compose.yml:1-29`
- **Description:** The `docker-compose.yml` defines three services (`redis`, `backend`, `frontend`) but does not specify any `deploy.resources.limits` for CPU or memory. Without resource limits, a single service can consume all host resources. A memory leak in the Node.js backend can OOM-kill the entire Docker host, affecting all containers including Redis and the frontend.
- **Impact:** Noisy-neighbor problem — one service can starve others. No protection against runaway memory or CPU consumption. On single-host deployments, this causes total system instability.
- **Evidence:**

  ```yaml
  # docker-compose.yml — no resource limits anywhere
  services:
    redis:
      image: redis:7-alpine
      ports: ["6379:6379"]
      restart: unless-stopped

    backend:
      build:
        context: .
        dockerfile: Dockerfile.backend
      ports: ["3001:3001"]
      env_file: .env
      depends_on: [redis]
      restart: unless-stopped
      # No deploy.resources.limits

    frontend:
      build:
        context: .
        dockerfile: Dockerfile.frontend
      ports: ["5173:80"]
      depends_on: [backend]
      restart: unless-stopped
      # No deploy.resources.limits
  ```

- **Recommendation:** Add resource limits to each service:
  ```yaml
  services:
    redis:
      # ...
      deploy:
        resources:
          limits:
            cpus: "0.5"
            memory: 256M
    backend:
      # ...
      deploy:
        resources:
          limits:
            cpus: "1.0"
            memory: 512M
    frontend:
      # ...
      deploy:
        resources:
          limits:
            cpus: "0.5"
            memory: 128M
  ```

### [FIND-004] No Production/Staging Environment Differentiation — Severity: Medium

- **Location:** `docker-compose.yml:1-29`
- **Description:** There is a single `docker-compose.yml` with no environment-specific overrides (e.g., `docker-compose.prod.yml`, `docker-compose.staging.yml`). The `.env` file is shared via `env_file: .env`, meaning the same deployment configuration is used for development, staging, and production. There are no Compose profiles (`profiles:`), no `docker-compose.override.yml`, and the `DEPLOYMENT.md` does not mention environment differentiation.
- **Impact:** Risk of deploying development configuration (e.g., debug logging, dev ports, test API keys) to production. No ability to add production-specific services (monitoring agents, log shippers, WAF sidecars) without modifying the base file.
- **Evidence:**
  ```yaml
  # docker-compose.yml — single file, no profile or override support
  version: "3.8"
  services:
    redis:
    backend:
      env_file: .env # Single .env file, no per-environment env files
    frontend:
  ```
- **Recommendation:** Create `docker-compose.prod.yml` and `docker-compose.staging.yml` override files. Add Compose profiles for development-only services. Document the deployment command:
  ```bash
  docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
  ```

### [FIND-005] No Pre-Push Hook for Tests — Severity: Medium

- **Location:** `.husky/pre-commit:1`
- **Description:** The only Husky hook is a `pre-commit` hook that runs `npx lint-staged`. There is no `pre-push` hook to run the test suite before pushing. While linting catches stylistic issues, it does not catch regressions. The `prepare` script in `package.json` (`"prepare": "husky"`) correctly installs Husky, but the pre-commit hook only runs lint-staged (ESLint + Prettier), not tests.
- **Impact:** Developers can push code that breaks tests, only discovering failures after CI runs. This increases CI cycle time and reduces developer velocity.
- **Evidence:**

  ```bash
  # .husky/pre-commit — only runs lint-staged
  npx lint-staged

  # .lintstagedrc.json — only eslint and prettier
  {
    "*.{js,jsx}": ["eslint --fix", "prettier --write"],
    "*.{css,json,md}": ["prettier --write"]
  }

  # No .husky/pre-push file exists
  ```

- **Recommendation:** Add a `.husky/pre-push` hook:
  ```bash
  npm test -- --run
  ```
  Add `npm run build` to the pre-push hook for projects where build failures are common.

### [FIND-006] No Automated Database Migration Step in CI/CD — Severity: High

- **Location:** `.github/workflows/ci.yml:1-79`, `package.json:6-19`, `DEPLOYMENT.md:41-42`
- **Description:** The CI pipeline runs lint, test, and build, but there is no database migration step. The `DEPLOYMENT.md` instructs developers to manually run `server/db/migration_v2.sql` in the Supabase SQL editor. There is no script in `package.json` for running migrations programmatically, and the CI pipeline has no migration step. This means every deployment requires manual SQL execution, which is error-prone and not auditable.
- **Impact:** Failed or forgotten migrations cause deployment to break silently. Rollbacks require manual SQL reversal. There is no way to audit which migration version is currently deployed. Inconsistent database schemas across environments.
- **Evidence:**

  ```yaml
  # .github/workflows/ci.yml — no migration step in any job
  jobs:
    lint:
      steps: [... npm ci, npm run lint]
    test:
      steps: [... npm ci, npm test -- --run]
    build:
      steps: [... npm ci, npm run build]
    security:
      steps: [... npm ci, npm audit, grep for secrets]

  # DEPLOYMENT.md:41-42
  # 2. Run `server/db/migration_v2.sql` in the Supabase SQL editor
  ```

- **Recommendation:** Create a migration script (e.g., `server/db/migrate.js`) that reads SQL files and executes them against Supabase. Add a `npm run migrate` script. Add a `migrate` step to the CI pipeline before the test job. Use an immutable migration pattern (never modify existing migration files) and track applied migrations in a `_migrations` table.

### [FIND-007] No Secrets Scanning in CI — Severity: High

- **Location:** `.github/workflows/ci.yml:73-78`
- **Description:** The CI pipeline's security job includes a rudimentary secrets check using `grep -r "sk-[a-zA-Z0-9]"` to find OpenAI-style API keys. This only catches OpenAI key patterns (`sk-...`), not Anthropic (`sk-ant-...`), Groq (`gsk_...`), Supabase keys, JWT tokens, or generic secrets. There is no dedicated secrets scanning tool (e.g., `truffleHog`, `Gitleaks`, `git-secrets`). The check uses `continue-on-error: true`, so even if secrets are found, the pipeline does not fail.
- **Impact:** Accidental commits of secrets to the repository will not be caught, and even if detected, the pipeline does not block the merge. This creates a window where secrets are exposed in the git history before manual remediation.
- **Evidence:**
  ```yaml
  # .github/workflows/ci.yml:73-78
  - name: Check for secrets
    run: |
      if grep -r "sk-[a-zA-Z0-9]" --include="*.{js,jsx,ts,tsx,json,yaml,yml}" \
        --exclude-dir=node_modules --exclude-dir=dist .; then
        echo "WARNING: Potential API keys found in source files"
      else
        echo "No secrets found in source"
      fi
    # Only checks "sk-" pattern (OpenAI keys)
    # Missing: Anthropic (sk-ant-), Groq (gsk_), Supabase, JWT, private keys
    # continue-on-error is NOT set here, but the check is too narrow
  ```
- **Recommendation:** Add a `truffleHog` or `Gitleaks` scan step to the CI security job. Configure it to fail the pipeline (`exit 1`) if secrets are detected. Add a `.trufflehogignore` or `.gitleaksignore` file for false-positive exclusions. Scan the full git history, not just the working tree.

### [FIND-008] No Container Image Tagging Strategy — Severity: Medium

- **Location:** `docker-compose.yml:1-29`, `.github/workflows/ci.yml:1-79`
- **Description:** All Docker images are built and referenced as `:latest` (implicitly, since no tags are specified). There is no CI step to tag images with git commit SHA, semantic version, or build timestamp. There is no container registry configuration (Docker Hub, ECR, GCR) in the CI pipeline or deployment documentation.
- **Impact:** Cannot roll back to a specific image version. `:latest` is ambiguous — two developers building at different times get different images with the same tag. Production deployments cannot pin to a known-good version.
- **Evidence:**
  ```yaml
  # docker-compose.yml — no image tags
  services:
    backend:
      build:
        context: .
        dockerfile: Dockerfile.backend
      # image: tracellm-backend:latest (implicit)
    frontend:
      build:
        context: .
        dockerfile: Dockerfile.frontend
      # image: tracellm-frontend:latest (implicit)
  ```
- **Recommendation:** Add image tagging to the CI pipeline using the git SHA:
  ```yaml
  - name: Build and tag Docker images
    run: |
      docker build -f Dockerfile.backend -t tracellm-backend:${{ github.sha }} .
      docker build -f Dockerfile.frontend -t tracellm-frontend:${{ github.sha }} .
      docker tag tracellm-backend:${{ github.sha }} tracellm-backend:latest
  ```
  Use specific tags in `docker-compose.prod.yml` or deploy scripts.

### [FIND-009] `vite.config.js` Has `sourcemap: false` — Severity: Medium

- **Location:** `vite.config.js:26`
- **Description:** The Vite build configuration sets `sourcemap: false`, meaning no source maps are generated in the production build. While this reduces bundle size and prevents source code exposure, it makes production debugging significantly harder. Error stack traces in production point to minified bundle lines, not original source files. Without source maps, tools like Sentry cannot map production errors back to their original source locations.
- **Impact:** Production errors are significantly harder to debug. Stack traces reference obfuscated bundle positions instead of meaningful file:line locations. If Sentry or similar error tracking is added later, it will require a separate build with source maps.
- **Evidence:**
  ```js
  // vite.config.js:26
  build: {
    sourcemap: false,
    // ...
  }
  ```
- **Recommendation:** Either set `sourcemap: true` (generates separate `.map` files that are not served to clients) or use `sourcemap: 'hidden'` (generates source maps but does not reference them in the bundle). Upload hidden source maps to Sentry or your error monitoring service as a CI step:
  ```js
  build: {
    sourcemap: 'hidden',  // or true if SPA is behind auth
  }
  ```

### [FIND-010] Nginx Configuration Lacks Upstream Health Checks — Severity: Medium

- **Location:** `nginx.conf:1-20`
- **Description:** The `nginx.conf` proxies `/api/` requests to `http://backend:3001` with a 60-second read timeout but no active health checks, no upstream block with `health_check`, and no `max_fails`/`fail_timeout` configuration. If the backend becomes unhealthy, nginx will continue routing traffic to it, serving 502 errors to users. There is no rate limiting on the API proxy either.
- **Impact:** No graceful degradation when the backend is unhealthy. Users receive 502 errors instead of nginx returning a cached or maintenance response. No protection against upstream failures.
- **Evidence:**
  ```nginx
  # nginx.conf — no upstream health checks
  server {
      listen 80;
      location /api/ {
          proxy_pass http://backend:3001;
          proxy_http_version 1.1;
          proxy_set_header Upgrade $http_upgrade;
          proxy_set_header Connection 'upgrade';
          proxy_set_header Host $host;
          proxy_cache_bypass $http_upgrade;
          proxy_set_header X-Real-IP $remote_addr;
          proxy_read_timeout 60s;
          # No health_check, no max_fails, no fail_timeout
      }
      location / {
          try_files $uri $uri/ /index.html;
          # No rate limiting
      }
  }
  ```
- **Recommendation:** Add an upstream block with health checks:

  ```nginx
  upstream backend_upstream {
      server backend:3001 max_fails=3 fail_timeout=30s;
  }

  server {
      location /api/ {
          proxy_pass http://backend_upstream;
          # ...
      }
  }
  ```

  Add rate limiting in the `http` block:

  ```nginx
  limit_req_zone $binary_remote_addr zone=api:10m rate=30r/s;
  ```

### [FIND-011] No `.dockerignore` File — Severity: Low

- **Location:** Root directory
- **Description:** There is no `.dockerignore` file in the project root. When Docker builds the frontend image, the `COPY . .` instruction in `Dockerfile.frontend` copies the entire project directory into the build context, including `node_modules` (if present locally), `.env` files with secrets, `.git` history, and other unnecessary files. This increases build context size, slows builds, and potentially leaks secrets into the Docker image layers.
- **Impact:** Builds are slower due to large context upload. Secrets in `.env` files can leak into image layers. The `node_modules` directory, if present, can interfere with the clean `npm ci` install.
- **Evidence:**

  ```dockerfile
  # Dockerfile.frontend:3-6 — copies everything
  COPY package*.json ./
  RUN npm ci
  COPY . .
  RUN npm run build

  # No .dockerignore file exists
  ```

- **Recommendation:** Create a `.dockerignore` file:
  ```
  node_modules
  dist
  .env
  .env.local
  .git
  .github
  *.md
  coverage/
  tests/
  ```

### [FIND-012] No Deploy Workflow and No Rollback Strategy Documentation — Severity: High

- **Location:** `.github/workflows/`, `DEPLOYMENT.md`
- **Description:** There is no `deploy.yml` or any GitHub Actions workflow for deploying to production or staging. The `DEPLOYMENT.md` describes manual deployment via `docker compose up --build` and manual hosting on Vercel/Netlify/Railway, but there is no automated deployment pipeline. There is no rollback strategy documented anywhere — the `DEPLOYMENT.md` security checklist mentions rotating API keys but says nothing about how to revert a bad deployment.
- **Impact:** Every deployment requires manual intervention. There is no ability to quickly roll back a bad deployment. Deployment consistency is not guaranteed — two different engineers may deploy differently. No audit trail of deployments exists.
- **Evidence:**

  ````bash
  # No deploy.yml in .github/workflows/
  No files matched: .github/workflows/deploy*

  # DEPLOYMENT.md:46-50 — only manual Docker instructions
  ## Docker
  ```bash
  docker compose up --build
  ````

  # No rollback section exists in DEPLOYMENT.md

  ```

  ```

- **Recommendation:** Create a `.github/workflows/deploy.yml` workflow triggered on push to `main` or a release tag. Include steps for building, tagging, and pushing Docker images to a container registry, deploying to the target environment, running database migrations, and verifying health. Document the rollback strategy in `DEPLOYMENT.md`:
  ```markdown
  ## Rollback

  1. `docker compose pull <service>:<previous-version>`
  2. Update the image tag in docker-compose.prod.yml
  3. `docker compose up -d`
  4. Verify health at /api/health
  5. If database migration rollback is needed, run `npm run migrate:rollback`
  ```

## 4. Positive Highlights

1. **Multi-stage frontend Docker build** (`Dockerfile.frontend`): The frontend Dockerfile correctly uses a multi-stage build with a `node:20-alpine` build stage and an `nginx:alpine` runtime stage, keeping the final image small.

2. **CI pipeline with caching** (`.github/workflows/ci.yml`): GitHub Actions uses `actions/setup-node@v4` with `cache: 'npm'`, which caches `~/.npm` for faster `npm ci` across lint, test, build, and security jobs.

3. **Husky + lint-staged** (`.husky/pre-commit`, `.lintstagedrc.json`): Pre-commit hooks enforce ESLint and Prettier on staged files, preventing formatting issues from reaching the repository.

4. **npm audit in CI** (`.github/workflows/ci.yml:70-72`): The CI pipeline runs `npm audit --audit-level=high` to catch known vulnerabilities before merge.

5. **Good `.gitignore` coverage**: The `.gitignore` covers `.env` files, `node_modules`, `dist`, logs, and editor directories. It correctly whitelists `.env.example`.

6. **Chunk splitting in Vite** (`vite.config.js:17-24`): Manual chunk splitting separates `vendor`, `charts`, and `query` bundles, optimizing cache behavior for SPA assets.

## 5. Risk Scoring Summary

| ID       | Title                                       | Severity | Effort to Fix |
| -------- | ------------------------------------------- | -------- | ------------- |
| FIND-001 | Dockerfile.backend Runs as Root             | High     | 30min         |
| FIND-002 | No HEALTHCHECK in Either Dockerfile         | High     | 30min         |
| FIND-003 | No Resource Limits in docker-compose.yml    | High     | 30min         |
| FIND-006 | No Automated DB Migration Step in CI/CD     | High     | 4h            |
| FIND-007 | No Secrets Scanning in CI                   | High     | 2h            |
| FIND-012 | No Deploy Workflow and No Rollback Strategy | High     | 8h            |
| FIND-004 | No Prod/Staging Environment Differentiation | Medium   | 2h            |
| FIND-005 | No Pre-Push Hook for Tests                  | Medium   | 15min         |
| FIND-008 | No Container Image Tagging Strategy         | Medium   | 1h            |
| FIND-009 | `vite.config.js` Has `sourcemap: false`     | Medium   | 5min          |
| FIND-010 | Nginx Lacks Upstream Health Checks          | Medium   | 1h            |
| FIND-011 | No `.dockerignore` File                     | Low      | 5min          |

## 6. Recommendations by Priority

### Immediate (fix within sprint)

1. **FIND-001**: Add `USER appuser` to `Dockerfile.backend` after creating a non-root user with `addgroup`/`adduser`.
2. **FIND-002**: Add `HEALTHCHECK` to both `Dockerfile.backend` and `Dockerfile.frontend`.
3. **FIND-003**: Add `deploy.resources.limits` for all three services in `docker-compose.yml`.
4. **FIND-011**: Create a `.dockerignore` file to prevent secrets and unnecessary files from entering Docker build context.

### Short-term (next 2 sprints)

5. **FIND-007**: Replace the basic grep secrets check with `truffleHog` or `Gitleaks` in the CI pipeline, configured to fail on detection.
6. **FIND-006**: Create a migration script and add a `migrate` step to the CI pipeline before the test job.
7. **FIND-008**: Add Docker image tagging with `${{ github.sha }}` to the CI build step.
8. **FIND-009**: Set `sourcemap: 'hidden'` in `vite.config.js` and add source map upload to CI.
9. **FIND-004**: Create `docker-compose.prod.yml` and `docker-compose.staging.yml` override files.

### Long-term (roadmap)

10. **FIND-012**: Create a full deploy workflow in `.github/workflows/deploy.yml` with container registry push, environment deployment, migration execution, health verification, and rollback capability. Document the rollback strategy in `DEPLOYMENT.md`.
11. **FIND-005**: Add a `.husky/pre-push` hook that runs the test suite.
12. **FIND-010**: Add upstream health checks and rate limiting to `nginx.conf`.
