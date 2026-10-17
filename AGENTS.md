# AGENTS.md

Contributor guide for AI coding agents (Codex, Claude, or any other) working in this repository. Humans are welcome too.

> **Not the same file as `/agents.md`.** The app serves a public, agent-facing guide for *commerce agents* at `/agents.md` (see README). This root `AGENTS.md` is for agents that *write code* in this repo. Do not merge, rename, or cross-edit the two.

Coordination record: **GitHub Issue #101**. The repo owner (not any agent) decides what ships.

---

## 1. What VibeCart is

Commerce infrastructure for AI-built apps and AI agents. A merchant keeps their own app and Stripe account; VibeCart adds a small, inspectable commerce layer (MCP + UCP + durable cart + Stripe Checkout) that agents can discover and use. Payments settle directly to the merchant's Stripe account. Core is MIT and self-hostable; **VibeCart Cloud** is the optional managed layer.

Architecture is protocol-first: one trusted commerce backend, thin MCP/UCP/client adapters around it. Do not fork commerce logic per client or per model.

Stack: Next.js 15 (App Router) + React 19 + TypeScript + Tailwind, Stripe, Neon (Postgres), MCP, UCP. CI runs Node 20. Hosted on Vercel.

Read `README.md` first. It is the source of truth for what is live versus not finished.

## 2. Priorities (from Issue #101, in order)

| Pri | Item |
|---|---|
| P0 | #99 / PR #91 Core order durability, with non-production Neon acceptance |
| P0 | #56 Merchant authentication and tenant isolation |
| P1 | #58 Real merchant pilot: trusted SKUs, safe checkout, durable order and fulfillment test |
| P1 | #93 AI salesperson with verified catalog, fitment, and cart (isolated branch is fine) |
| P1 | #94 Shopify connector, then #97 merchant subscriptions, in verified dependency order |
| P2 | #92 analytics, #96 ShipStation, #95 consented recovery, #98 agent distribution |

Do not expand unrelated products while payment and merchant basics are unresolved. If a task is not on this list, ask the owner before starting it.

## 3. Working with other agents

Two or more AI agents may work here at once. To avoid collisions:

1. **GitHub issues and PR comments are the shared record.** They are not an auto-running command queue. Read them between tasks.
2. **Claim before you start.** Comment on the issue naming the branch and the files you expect to touch. If someone has claimed it, pick something else.
3. **One task, one branch, one PR.** Keep PRs small and focused.
4. **Do not touch another agent's in-flight branch or PR** (currently PR #91 and the stacked #93 work) except through review comments. Do not reimplement it.
5. **Stacked PRs:** say which PR you are stacked on, in the PR body, and target that branch as the base.
6. **Shared hotspots** (coordinate in the issue first): payment and checkout code, webhook handling, cart repricing, the MCP tool list, UCP discovery and mappers, `server.json`, `.codex-plugin/`, and public docs (`README.md`, `/llms.txt`, `/agents.md`).
7. If blocked (missing secret, database branch, paid quota, human approval), **log the blocker on the issue and move to the next independent safe task.**

## 4. Branches and pull requests

- Work on `agent/<short-topic>` branches. CI runs on every push to `agent/**` and on PRs into `main`.
- **Never push to `main`.** Never force-push a branch someone else has pushed to.
- Open a PR into `main` (or into the base branch of a stack). **Do not merge it.** Do not enable auto-merge. Green CI is necessary, not sufficient: the owner approves merges, and payment-path changes need explicit owner approval.
- PR body must include: what changed, what did **not** change, risk, the exact commands run with their real results, and anything not verified.
- Never claim a test passed unless you saw it pass. Say "not run" when it was not run.

## 5. Verification

Commands below come from `package.json` and `.github/workflows/ci.yml`. Run what applies to your change and report actual results.

```bash
npm install --no-audit --no-fund   # CI installs this way (Node 20)
npm run build                      # next build
npm run typecheck                  # tsc --noEmit
npm run lint                       # eslint .
npm test                           # node --test tests/*.test.mjs
```

CI additionally starts the production build and smoke-tests it:

```bash
npm start -- -p 3000               # in one shell
node scripts/smoke-mcp.mjs         # MCP commerce flow
node scripts/smoke-ucp-schema.mjs  # captures live UCP payloads
node scripts/smoke-ucp-order.mjs   # UCP order via the production mapper
```

CI then validates the UCP discovery profile and payloads against the pinned release `v2026-04-08` using `ucp-schema` 1.4.1, and inspects the MCP transport at `/mcp` with `@modelcontextprotocol/inspector@0.16.8` (the last v1 CLI that works on Node 20). Those steps need a Rust toolchain and the UCP spec checkout, so they normally run in CI only. If you change MCP or UCP surfaces, **read the CI result on your PR** rather than assuming.

Notes:

- `npm test` only globs `tests/*.test.mjs`. Other files in `tests/` (for example `*.sql` smoke tests) are **not** run by it and must be run deliberately against a **non-production** database branch.
- Other workflows exist in `.github/workflows/`: `ucp-cart-conformance.yml` and `publish-mcp-registry.yml`. Do not edit or trigger the publish workflow without owner approval, since it publishes externally.
- Docs-only changes still need the PR to show CI green or an explicit statement of what was not run.
- Any new behavior needs a test in `tests/` in the same PR. Prefer `.test.mjs` so `npm test` picks it up.

## 6. Security and safety rules (non-negotiable)

**Never**, without explicit owner approval in the issue or PR:

- merge to `main`, or deploy to production
- change production environment variables, secrets, DNS, or Vercel/Neon/Stripe settings
- process real payments, issue real refunds, or send real customer communications
- publish live billing or subscriptions
- add paid services, new infrastructure, scheduled GitHub Actions, or metered API usage

Code and data rules:

- **Secrets stay server-side and out of git.** `.env.example` documents variable *names* only. Never commit values. Never print secrets in logs, tests, PR text, or screenshots. Never put Stripe, database, catalog, or Cloud credentials in client config or provider adapters.
- **Test mode only.** Use Stripe test keys. `HSN_CHECKOUT_MODE` must match the key type, and `HSN_CHECKOUT_ENABLED` stays `false` in anything you ship. Do not use a live key to "just check".
- **Prices are trusted only when resolved on the server** from the configured catalog provider. Never accept client- or agent-supplied prices as real.
- **Fail closed.** If `VIBECART_CATALOG_URL` is configured and unhealthy or invalid, commerce operations must fail rather than fall back to demo products. Keep the HTTPS-only, private-network-blocked, redirect-blocked, time- and size-bounded fetch rules for any outbound fetch.
- **Verify Stripe webhook signatures** before any post-payment processing. Keep delayed-payment completion separate so orders are not created early. Keep order creation idempotent.
- **Carts are server state,** versioned and repriced on the server, not trusted from the browser or agent.
- **Public health and discovery endpoints expose booleans and capabilities only,** never credential values.
- **Do not advertise unshipped capabilities.** Optional UCP capabilities appear only when their runtime dependencies are valid, and discovery text is regression-tested against what is actually shipped. Do not claim durable orders, inventory, fulfillment, merchant-of-record status, or agent-native machine payment unless it is implemented and tested.
- Tenant isolation matters (#56). Never write code that lets one merchant read another merchant's carts, orders, or events.
- Use a non-production Neon branch for any database work. Never run migrations or destructive SQL against production.

## 7. Spending rules

Use existing included allowances only. No unattended metered API use, no scheduled workflows, no paid services without owner opt-in and a tested spending limit. Queue automation (an agent that runs on a schedule) is explicitly **not activated**; see "Optional phase 2" in Issue #101.

## 8. Where things are

Verified paths (not exhaustive):

- `README.md` is the live-versus-not-finished source of truth
- `lib/products.ts` is demo and reference catalog data only
- `tests/` holds Node tests (`*.test.mjs`) and SQL smoke tests
- `scripts/` holds the smoke scripts CI runs
- `docs/integrations/agent-clients.md` and `integrations/mcp-clients.json` cover client distribution
- `server.json` is the MCP server manifest; `.codex-plugin/` is the Codex plugin manifest
- `skills/` holds agent skills shipped with the repo
- `.github/workflows/` holds CI, UCP conformance, and MCP registry publishing
- `.env.example` lists runtime variable names

Before editing an area, read its neighbors and existing tests. Match existing style. Keep diffs minimal. Do not reformat unrelated files.

## 9. Known limits (do not paper over)

From the README: the remote catalog connector is a simple trusted JSON-provider contract, not a multi-merchant control plane; inventory, automated tax calculation, shipping-rate calculation, returns/refunds, and a complete fulfillment lifecycle are not finished platform services; public UCP order lookup is activation-gated. Treat these as open work, not as features to describe as done.

## 10. Maintaining this file

Update `AGENTS.md` in the same PR whenever you change verification commands, branch strategy, or guardrails. Keep it short and factual. If it disagrees with `ci.yml` or `package.json`, those win; fix this file.
