# Deploying rda-insights to EasyPanel

This guide deploys `rda-insights` as a peer service to `superset-stack` and `superset-mcp` on the same EasyPanel project, so it can reach the MCP over the internal Docker network.

Target: one new EasyPanel service, one new domain, ~10 env vars, no DB of its own (uses the existing Redis from `superset-stack`).

---

## 1. Push the repo to GitHub

The `rda-insights` repo is a standalone git repo living inside `D:\SuperSet_agent\rda-insights\`. The parent `D:\SuperSet_agent\` directory is **not** a git repo, so don't try to push from there.

```powershell
cd D:\SuperSet_agent\rda-insights
git remote add origin git@github.com:<your-user>/rda-insights.git   # if not already
git push -u origin master
```

Keep the repo **private** — `.env.local` is gitignored but the deploy values still don't belong on public GitHub.

---

## 2. Pre-requisite: expose `superset-mcp` publicly on EasyPanel

> Without this, local E2E and probe scripts can't reach the MCP. The deployed `rda-insights` will use the internal URL `http://superset-mcp:5008` — the public domain is only needed for local development.

Open `D:\SuperSet_agent\deploy\easypanel-compose.yml`. The `superset-mcp` service has `expose: ["5008"]` but no `Domain` block. In the EasyPanel UI:

- Open the `superset-mcp` service → **Domains** → **Add Domain**.
- Container port: `5008`.
- Suggested host: `mcp-melanibotto-rdasuperset.bdoje9.easypanel.host`.

Save and wait for the cert to provision.

---

## 3. Create the `rda-insights` service in EasyPanel

In the **same project** as `superset-stack` (so they share the internal network):

- Click **+ Service** → **App**.
- Name: `rda-insights`.
- Source: **GitHub** → select the repo from step 1 (auth with a GitHub PAT if private).
- Branch: `master` (or `main` if you've renamed).
- Build: **Nixpacks** — auto-detects Next.js and runs `npm run build` then `npm start`.

Don't deploy yet — set env vars first.

---

## 4. Set environment variables

In the new service → **Environment** → add these one at a time:

| Key | Value | Notes |
|---|---|---|
| `APP_USERNAME` | `admin` | Or whatever you want as the Basic Auth user. |
| `APP_PASSWORD` | _(generate)_ | `openssl rand -base64 24` — write it down. |
| `OPENROUTER_API_KEY` | `sk-or-v1-...` | From https://openrouter.ai/keys. |
| `OPENROUTER_MODEL` | `anthropic/claude-sonnet-4.5` | Any model slug at https://openrouter.ai/models. Defaults to Sonnet 4.5; swap to `openai/gpt-4o`, `google/gemini-2.5-pro`, etc. |
| `MCP_INTERNAL_URL` | `http://superset-mcp:5008` | Internal service name. No TLS. |
| `MCP_JWT_SECRET` | _(copy from compose)_ | **Must match** `MCP_JWT_SECRET:` on line 38 of `D:\SuperSet_agent\deploy\easypanel-compose.yml`. If they differ, every MCP call gets a 401. |
| `MCP_JWT_ISSUER` | `claude-code-user` | |
| `MCP_JWT_AUDIENCE` | `superset-mcp` | |
| `SUPERSET_URL` | `https://melanibotto-rdasuperset.bdoje9.easypanel.host` | Public Superset URL — the iframe needs this. |
| `REDIS_URL` | `redis://redis:6379/2` | DB 2 — DBs 0 and 1 are used by Superset. |
| `MAX_USD_MONTH` | `20` | Approximate monthly OpenRouter spend cap (USD). Check the OpenRouter dashboard for authoritative spend. |

> **The `MCP_JWT_SECRET` is the most common source of "everything looks deployed but nothing works" failures.** Open the compose file, copy the exact string (no surrounding quotes), and paste it as the EasyPanel env var.

---

## 5. Add a domain

Service → **Domains** → **Add Domain**:

- Container port: `3000`.
- Suggested host: `insights-melanibotto-rdasuperset.bdoje9.easypanel.host`.
- Or point a custom domain via CNAME to the EasyPanel IP and add it here.

---

## 6. Deploy

Click **Deploy** (or push a new commit and let auto-deploy fire). Watch the build log:

- Nixpacks detects Next.js, runs `npm ci`, then `npm run build`.
- Container starts with `npm start` on port 3000.

Build is ~2 min on EasyPanel's default builder.

---

## 7. Smoke check the health endpoint

```bash
curl -u admin:<APP_PASSWORD> https://<your-domain>/api/health
```

Expected:

```json
{"ok":true,"mcp":"up","openrouter":"configured","redis":"up"}
```

| If you see... | Then... |
|---|---|
| `401 Unauthorized` (no JSON) | Basic auth creds wrong. |
| `"mcp":"down"` | MCP service not reachable. Re-check `MCP_INTERNAL_URL`, that `superset-mcp` is in the same project, and that the JWT secret matches step 4. |
| `"redis":"down"` | `REDIS_URL` wrong, or `redis` service is in a different project. |

---

## 8. Manual smoke test in the browser

1. Open `https://<your-domain>/` → browser prompts for Basic Auth → enter the creds from step 4.
2. You land on a dashboard list.
3. Click a dashboard → iframe loads on the left, AI sidebar on the right.
4. Click **Resumir grafico** on any chart → 3 bullets stream in under ~5s.
5. Apply a cross-filter on the dashboard → the **Explicar selecao** button appears in the sidebar → click → text streams.

If steps 4 or 5 hang, jump to **Troubleshooting** below.

---

## 9. (Optional) Run the E2E smoke against the deployed instance

From your local machine:

```powershell
$env:E2E_BASE_URL = "https://<your-domain>"
$env:APP_USERNAME = "<your-admin-user>"
$env:APP_PASSWORD = "<your-password>"
npx playwright test
```

This hits the deployed app and exercises the chart-summary streaming path end-to-end. Good for staging validation before pointing real users at a new build.

---

## 10. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `502` on `/` | MCP unreachable. | Verify `MCP_INTERNAL_URL=http://superset-mcp:5008` and that the `superset-mcp` container is running in the same project. |
| Streaming hangs forever on first token | `OPENROUTER_API_KEY` invalid, model slug wrong, or rate-limited at OpenRouter. | Test the key with `curl https://openrouter.ai/api/v1/models -H "Authorization: Bearer $OPENROUTER_API_KEY" | head`. Verify model exists at https://openrouter.ai/models. |
| `429` on every request from a fresh deploy | In-memory rate-limit counter holding stale state from prior testing. | Restart the container — counters live in memory, not Redis. |
| `"Cost cap reached"` with no actual usage | Stale Redis counter for the current month from prior testing. | `redis-cli -u $REDIS_URL del monthly_cost:YYYY-MM` (e.g. `monthly_cost:2026-05`). |
| Iframe shows Superset login screen instead of the embedded dashboard | `SUPERSET_URL` wrong, or the dashboard isn't published as embedded in Superset. | Verify URL + open the dashboard in Superset → Settings → Embed and check it's enabled. |
| MCP calls return 401 in logs | `MCP_JWT_SECRET` mismatch between this service and `superset-mcp`. | Re-copy the secret from `deploy/easypanel-compose.yml` exactly. |
