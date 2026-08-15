# VibeCart Agent Commerce Roadmap

## North star

VibeCart is commerce infrastructure for AI-built businesses and AI agents.

A merchant should connect VibeCart once, keep its own application and Stripe account, and expose a standard commerce surface that capable agents can discover and use.

VibeCart should not build a separate commerce engine for every LLM. The durable architecture is one merchant commerce backend exposed through open protocols, with thin provider-specific packaging where needed.

## Product position

VibeCart is not trying to replace every part of Shopify on day one.

The wedge is:

> Keep the app AI built for you. Keep your Stripe account. Add VibeCart and make the business agent-commerce capable.

Primary targets include AI-generated storefronts, SaaS apps, independent websites, and custom applications that do not want to migrate onto a traditional hosted commerce platform.

## Current foundation

The current repository already provides useful building blocks:

- a remote MCP endpoint for agent tool use
- a trusted server-side product catalog
- a Stripe Checkout route that supports multiple trusted line items
- same-origin redirect protection
- Stripe webhook signature verification
- public machine-readable metadata
- CI smoke testing for the MCP surface
- VibeCart Cloud and managed-setup sales surfaces

The current MCP contract is still VibeCart-specific and the Stripe webhook in this repository is not yet a durable order system.

## Architecture rule

Build protocol-first, adapter-second.

The target stack is:

AI / agent
→ MCP, UCP, REST, portable skills
→ VibeCart commerce protocol layer
→ VibeCart merchant operating system
→ merchant catalog, Stripe, orders, fulfillment, subscriptions, and business systems

Provider-specific packages for ChatGPT/Codex, Claude, Gemini, Cursor, VS Code, and future agents should be thin wrappers around the same backend capabilities.

## Phase 0 — harden the existing commerce core

Before expanding the public protocol surface:

- disable client-supplied pricing in production unless the server explicitly opts in
- rate-limit checkout creation
- redact internal exceptions from API responses
- preserve server-side trusted pricing
- preserve same-origin redirect controls
- connect verified Stripe events to durable VibeCart Cloud order/event state
- make the public Cloud purchase/subscription flow match the live managed service

Exit condition: the existing checkout primitive is safe enough to become a dependency of higher-level commerce tools.

## Phase 1 — UCP discovery and catalog compatibility

Implement UCP deliberately rather than claiming compatibility early.

Deliverables:

- merchant business profile at `/.well-known/ucp`
- canonical `agents.md`
- UCP capability negotiation and version handling
- UCP catalog search capability
- UCP catalog lookup capability
- MCP transport that uses the UCP-defined tool names and schemas
- conformance tests against published UCP schemas
- compatibility fixtures for OpenAI, Anthropic, Google, and generic MCP clients

Do not advertise a UCP capability until its required request metadata, negotiation, schemas, and error behavior are implemented.

## Phase 2 — durable cart service

Move from direct checkout primitives to an agent-safe cart lifecycle.

Deliverables:

- durable cart storage
- `create_cart`
- `get_cart`
- `update_cart`
- `cancel_cart`
- context/localization fields
- idempotency handling
- cart expiration
- conversion from cart to checkout

Neon is the preferred durable state layer for this phase unless a better repository-specific reason emerges.

## Phase 3 — checkout and orders

Expose a complete transaction lifecycle while keeping the merchant as merchant of record.

Deliverables:

- UCP checkout sessions
- multi-item totals
- buyer and fulfillment inputs where needed
- handoff to hosted Stripe Checkout where appropriate
- verified payment completion
- durable order records in VibeCart Cloud
- `get_order`
- order webhooks/event delivery
- tracking state
- cancellation/return request workflow where merchant systems support it

## Phase 4 — merchant control plane

VibeCart Cloud becomes the merchant operating system rather than only a managed-hosting product.

Deliverables:

- merchant identity
- stores
- catalog connections
- orders
- customers
- Stripe connection state
- webhook delivery history
- retries and dead-letter handling
- fulfillment integrations
- agent permissions
- analytics
- API keys / OAuth where required
- billing and plan enforcement

## Phase 5 — distribution

Make installation simple in every major agent environment without forking the commerce backend.

Targets:

- ChatGPT / Codex
- Claude / Claude Code
- Gemini / Google agent tooling
- Cursor
- VS Code
- other MCP/UCP-capable clients

Distribution artifacts may include MCP configuration, portable skills, marketplace packages, setup wizards, and generated integration instructions.

## Longer-term platform opportunity

Once VibeCart has many merchants on one normalized commerce layer, the higher-value assets become:

- cross-merchant catalog discovery
- normalized merchant identity
- agent permissions and trust
- universal cart orchestration
- order state across merchants
- merchant analytics for agent-originated sales
- a network of AI-built businesses that can sell without migrating platforms

## Business model constraints

The preferred model is software/infrastructure revenue rather than becoming merchant of record.

VibeCart should preserve these advantages unless the economics clearly justify changing them:

- merchant owns the Stripe account
- merchant receives funds directly
- VibeCart charges for infrastructure, Cloud, managed services, usage, or higher-level commerce capabilities
- no requirement that a merchant rebuild its application on VibeCart

## What not to do

- do not create six different commerce engines for six LLM vendors
- do not claim UCP compliance before conformance work is complete
- do not become a giant storefront builder before the protocol layer has traction
- do not make client-controlled prices a production default
- do not let marketing outrun order durability, security, or fulfillment reality

## Immediate build sequence

1. Finish Phase 0 security and Cloud event plumbing.
2. Add UCP discovery and conformance scaffolding.
3. Normalize the current catalog behind UCP catalog tools.
4. Add durable carts backed by Neon.
5. Convert carts into checkout and durable orders.
6. Package the same capabilities for the major agent ecosystems.
