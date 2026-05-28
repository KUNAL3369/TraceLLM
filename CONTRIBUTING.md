# Contributing

## Development Setup

```bash
git clone https://github.com/KUNAL3369/TraceLLM.git
cd TraceLLM
npm install
cp .env.example .env  # Fill in your keys
npm run dev:all       # Starts both frontend + backend
```

## Code Style

- ESLint + Prettier enforced via pre-commit hooks
- Run `npm run lint:fix` before committing
- All new features must include tests

## Commit Convention

We use conventional commits:
- `feat:` new feature
- `fix:` bug fix
- `security:` security improvement
- `perf:` performance improvement
- `docs:` documentation
- `test:` testing
- `chore:` maintenance

## Pull Request Process

1. Create a feature branch from `main`
2. Write tests for new functionality
3. Ensure `npm run lint` and `npm test` pass
4. Update documentation if needed
5. Open PR with description of changes

## Project Structure

```
server/         Express backend (routes, services, middleware, db)
src/            React frontend (pages, components, hooks, stores, lib)
```

All server code lives under `server/`; all frontend code under `src/`.
There is no separate server `package.json` — the monorepo root handles both.
