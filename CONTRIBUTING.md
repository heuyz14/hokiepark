# Contributing

## Setup
Node >= 24 (`.nvmrc`). `npm ci`, then `npm run check`. Copy `.env.example` to `.env.local` only if you need the live feed or the advisor.

## Workflow
1. Branch from `main`; keep changes small and focused.
2. `npm run check` must pass (typecheck + unit tests + build); run `npm run smoke` for UI changes and `npm run test:py` for `databricks/`.
3. If you change something a generated file is built from, regenerate it (`npm run data|seed|curves|advisor:build|databricks:inputs`) and commit the result; tests fail if it is stale.
4. Merge `origin/main` before pushing. CI (`.github/workflows/ci.yml`) runs on every push and pull request.
5. Deploys are manual: Actions -> Deploy to Pages.

## Conventions
- **Pure logic in `src/lib/` with a test; DOM only in `src/ui/`.** New behaviour needs a test that fails without it.
- **Safety-relevant rules get a mutation-style test** (break the rule on purpose and confirm the test fails): permit verdicts, the advisor's number guard, origin allow-listing.
- **Label simulated data as simulated**, everywhere it is shown.
- **Never commit secrets** (`.env.local` is ignored). See `SECURITY.md`.
- Commit messages: a short imperative subject, a body that says why. Stage explicit paths, not `git add -A`, when several people work in one checkout.

## Where things go
See the layout in the root `README.md`, and `docs/README.md` for documentation. Update `docs/STATE.md` (status) and append to `docs/PROMPT_HISTORY.md` after each task.
