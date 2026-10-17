# AI Readiness report (Issue #105): offline diagnostics

Status: **a manual, offline diagnostic. An evaluator, a browser-only page, and tests. Not connected to any store, not fed by live endpoint probes, nothing stored.**

## What it answers

| Question | How it is decided |
|---|---|
| Is product data complete and valid? | Mirrors the rules `lib/catalog-source.ts` enforces (id, name, integer `priceCents`, HTTPS image, lengths, duplicate ids), plus warnings for missing description, image or a zero price |
| Are prices and currency correct? | Prices must be non-negative integer cents. Currency is **never detected or assumed**: you must supply it (the page starts blank), and it must be an ISO 4217 code with two minor-unit digits |
| Are variant identifiers right? | If a `shopify` block is present, its variant id must equal the catalog id. Without one, the report says ids cannot be checked against your store. A `shopify.inventoryPolicy` is carried as data and never changes exposure |
| Is each product suitable for exposure through VibeCart MCP/UCP? | A product with no blocking problems is `exposable`. This means VibeCart could serve it correctly, nothing more |
| Are MCP/UCP endpoints and capabilities verified? | Only from probe evidence with `origin: 'server_probe'` that is `ok`, fresh (default 24 h), not future-dated, from the expected URL when one is set, and lists every required capability. Manual evidence is never trusted. No evidence means `not_verified` |
| Is the data fresh? | Needs `lastSyncedAt`. Unknown or older than the limit is a warning |
| What blocks readiness? | `blockers` and `warnings`, grouped by code with counts and example ids |

Required capabilities (from the README's published tool lists): MCP `vibecart.list_products`, `vibecart.get_product`; UCP `create_cart`, `get_cart`, `update_cart`, `cancel_cart`.

## Trust model for endpoint evidence

The evaluator is pure, so it cannot prove evidence is genuine. `origin: 'server_probe'` is only a claim by whoever builds the input. Production use must build that evidence in a trusted server-side probe that fetches the endpoints itself. The browser page never supplies probes, so it always shows endpoints as not verified.

## What it does not say

It does not measure or predict whether any AI assistant will find, rank or recommend a product, and the shipped text names no third-party AI provider. `ready_for_agent_testing` means "no blockers found in the data and endpoints you supplied", not "agents will buy from you".

## Files

- `lib/ai-readiness.ts`: pure evaluator (imports only `normalizeCurrency` from the Shopify mapper)
- `components/ai-readiness-dashboard.tsx`, `app/ai-readiness/page.tsx`: paste-a-catalog page, `noindex`, labeled manual and offline. The check runs in the browser; nothing is uploaded
- `tests/ai-readiness.test.mjs`

## Not done, and what gates it

| Item | Gate |
|---|---|
| Trusted server-side probe that calls `/mcp` and `/ucp/mcp` and produces evidence | Needs the real response shapes verified in a non-production run; a server route is tenant-scoped work that depends on #56 |
| Reading a merchant's stored catalog and sync time | Per-tenant persistence (#56) and the sync wiring from #94 |
| Cart and checkout round-trip verification | Codex's #91/#93 work. Not touched here |
| Showing the page to merchants | Merging deploys a public `noindex` page on the next release; owner decision |
