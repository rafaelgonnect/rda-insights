# rda-insights

AI Insights Panel for Apache Superset. A Next.js 16 app that embeds Superset dashboards via iframe and adds an AI sidebar powered by Claude Sonnet 4.6.

## What it does

Embeds an existing Apache Superset deployment and adds two AI features in a sidebar next to every dashboard:

- **Resumir grafico** — generates a 3-bullet summary of any chart on the dashboard.
- **Explicar selecao** — when the user applies a cross-filter on the dashboard, explains what the selection means and what changed.

Both features stream responses from Claude over Server-Sent Events. The app pulls chart context (queries, sample data, metadata) from a sibling MCP service (`superset-mcp`) over the internal EasyPanel network using a short-lived JWT.

## Stack

| Layer | Tech |
|---|---|
| Framework | Next.js 16 (App Router) |
| Language | TypeScript |
| Styling | Tailwind v4 + shadcn/ui |
| Embed | `@superset-ui/embedded-sdk` |
| LLM | `@anthropic-ai/sdk` (Claude Sonnet 4.6, streaming) |
| Auth (app gate) | HTTP Basic Auth via middleware |
| Auth (MCP) | `jose` — HS256 JWT, 5 min expiry |
| Rate limit / cost cap | `ioredis` |
| Tests | Vitest 4 + MSW v2 (unit/integration), Playwright (E2E) |

## Architecture

```
+--------------+      iframe       +-----------------+
|  Browser     |  <-------------   |  superset       |
|  (basic auth)|                   |  (Superset 6)   |
+------+-------+                   +-----------------+
       |                                    ^
       | HTTPS                              | internal HTTP
       v                                    |
+--------------+      HTTP+JWT     +-----------------+
|  rda-insights|  ------------->   |  superset-mcp   |
|  (Next.js)   |                   |  (FastAPI)      |
+------+-------+                   +-----------------+
       |
       | streaming SSE
       v
+--------------+
|  Anthropic   |
+--------------+
```

`rda-insights` deploys as a peer service to `superset-stack` and `superset-mcp` in the same EasyPanel project, so the MCP can be reached by service name on the internal network. Single-user MVP — one shared admin login behind Basic Auth.

## Dev setup

```bash
npm install
cp .env.example .env.local   # then fill in real values
npm run dev                  # http://localhost:3000 — prompts for basic auth
```

Required `.env.local` values:

- `APP_USERNAME`, `APP_PASSWORD` — Basic Auth gate.
- `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` (`claude-sonnet-4-6`).
- `MCP_INTERNAL_URL` — for local dev, the public MCP domain (see `DEPLOY.md` step 2).
- `MCP_JWT_SECRET` — must match the value in `D:\SuperSet_agent\deploy\easypanel-compose.yml`.
- `MCP_JWT_ISSUER` (`claude-code-user`), `MCP_JWT_AUDIENCE` (`superset-mcp`).
- `SUPERSET_URL` — public Superset URL.
- `REDIS_URL` — `redis://localhost:6379/2` locally, `redis://redis:6379/2` on EasyPanel.
- `MAX_USD_MONTH` — monthly Anthropic spend cap, e.g. `20`.

### Tests

```bash
npm test                     # 36 unit/integration tests via Vitest
npx playwright test          # E2E smoke (needs running dev server + real services)
```

## Scripts

| Script | What it does |
|---|---|
| `npm run dev` | Next.js dev server on :3000 |
| `npm run build` | Production build |
| `npm start` | Run the production build |
| `npm run lint` | ESLint |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Vitest run (unit + integration, excludes `e2e/`) |
| `npm run test:watch` | Vitest watch mode |
| `npm run test:coverage` | Vitest with v8 coverage |
| `npm run e2e` | Playwright E2E suite |

## Project structure

```
rda-insights/
├── app/                 # Next.js App Router routes + API handlers
│   └── api/             # /api/health, /api/summarize, /api/explain, /api/dashboards
├── components/          # InsightsSidebar, DashboardEmbed, shadcn primitives
├── lib/                 # mcp client, anthropic client, jwt, redis, cost cap, rate limit
├── __tests__/           # Vitest unit + integration tests (with MSW handlers)
├── e2e/                 # Playwright E2E smoke
├── scripts/             # MCP/Anthropic probe scripts
├── proxy.ts             # (legacy proxy helper; not used in prod)
└── ...                  # configs (next/vitest/playwright/tailwind/eslint/tsconfig)
```

## Status

MVP. Feature-complete for the two AI features. 36 unit/integration tests + 1 E2E smoke pass.

Not in scope for this MVP:

- Multi-user auth (currently single shared Basic Auth login).
- RBAC / per-user dashboard filtering.
- Audit log of LLM calls.
- Email/Slack alert when the monthly cost cap is hit.
- Text-to-SQL Q&A over datasets.
- Anomaly / forecast features.
- Custom table viz plugin.

The full design lives in the parent repo at `D:\SuperSet_agent\docs\superpowers\specs\2026-05-14-ai-insights-panel-design.md`; the implementation plan is at `D:\SuperSet_agent\docs\superpowers\plans\2026-05-14-ai-insights-panel.md`.

## Deploy

See [`DEPLOY.md`](./DEPLOY.md) for the EasyPanel deploy walkthrough.
