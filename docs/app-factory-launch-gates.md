# App Factory launch gates

Canonical launch focus: ship and monetize the existing small app set before adding more concepts.

## Existing working products

1. Link + QR + UTM Manager — merged to `main` via PR #75.
2. Image Toolkit — merged to `main` via PR #79.
3. PDF Toolkit — merged to `main` via PR #80.

## Subscription gate

PR #77 contains the existing Stripe all-app subscription implementation. Do not rebuild it from scratch. Its base predates the current `main`, so it must be reconciled with current auth/webhook/app-library code before merge.

Required release proof before paid launch:

- authenticated checkout creates a Stripe subscription session;
- verified Stripe webhook grants `all-apps` entitlement;
- active/trialing subscription unlocks all three existing apps;
- canceled/incomplete-expired subscription removes paid access;
- webhook retry is idempotent;
- no production checkout is enabled until the configured Stripe price, webhook secret, and Neon entitlement storage are verified;
- production database/payment changes remain a separate approval gate.

## Next implementation milestone

Rebase/reconcile PR #77 onto current `main`, add regression tests covering checkout metadata and subscription lifecycle entitlement transitions, and get CI/preview green. Preserve PR #81 (Uptime Monitor) without expanding it until the first three apps have a verified paid subscription path.
