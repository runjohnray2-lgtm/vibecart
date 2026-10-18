# Offline merchant shopping acceptance

Run `npm install --no-audit --no-fund`, then `npm test`.

`tests/hosted-checkout-integration.test.mjs` executes the actual merchant auth, cart store, checkout, MCP sales tool handlers, product/fitment logic, Stripe webhook handler, order normalization and order store. It uses in-memory PGlite PostgreSQL with migrations 001/004/005/007/008, actual SQL transactions and Stripe's actual signature verifier. Only the external Stripe and Neon transports are replaced. No real credential, merchant export, provider LLM or network checkout is used.

Covered workflow:

- trusted synthetic catalog discovery and safe no-match response through MCP JSON-RPC
- attributed cart creation/replay with server-resolved prices despite caller-supplied price fields
- merchant/cart authorization, cross-tenant rejection and exact line/quantity matching
- current out-of-stock and changed fitment rejection at checkout
- cart capability handoff into tenant-tagged Stripe session parameters
- tampered signed payload rejection without logging customer payload/signature
- injected line-write failure rolls back the order header, payment event and cart conversion
- recovery, duplicate webhook and distinct async event preserve one order and all lines
- sales source/session/channel survives into the durable order

This is request-level offline MCP acceptance, not proof that a separately connected external agent or real Stripe/Neon staging flow succeeded. CI's production transport and official UCP checks cover their own stated contracts. No marketplace/provider-distribution claim follows from either.

A real Radiantz pilot remains blocked until Issue #108's dedicated database/role, effective branch-only Preview URL, matching Stripe test endpoint credentials, merchant isolation, outbound disablement, deployment protection and zero-additional-cost checks are independently recorded. Do not run these integration assertions against the currently shared Preview database. Health's `ok` is configuration-only and is not authorization to transact.
