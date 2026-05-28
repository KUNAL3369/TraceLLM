# Testing

## Running Tests

```bash
# Unit tests (Vitest)
npm test                 # Watch mode
npm run test:run         # Single run
npm run test:coverage    # With coverage report

# E2E tests (Playwright)
npx playwright install
npm run test:e2e
```

## Test Structure

```
src/test/               Frontend unit tests
  setup.js              Test environment setup
  components.test.jsx   Component tests
e2e/                    Playwright E2E tests (TBD)
```

## Coverage

Coverage reports are generated in `coverage/`. Minimum thresholds:

- Statements: 60%
- Branches: 50%
- Functions: 60%
- Lines: 60%

## CI/CD Pipeline

The GitHub Actions pipeline runs on every push to `main` and on PRs:

1. **Lint** — ESLint check
2. **Test** — Vitest unit tests
3. **Build** — Vite production build
4. **Security** — npm audit + secret scanning

## Pre-commit Hooks

Husky + lint-staged runs ESLint and Prettier on staged files before every commit.
