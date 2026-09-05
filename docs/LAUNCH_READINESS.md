# VibeCart launch readiness

Updated: 2026-09-05

## First-wave apps

Keep the launch set deliberately small. The current first wave is:

1. Link / QR / UTM Manager
2. Image Toolkit
3. PDF Toolkit

Do not add more app concepts to the launch set until these three pass the gates below.

## Shared platform gates

- [x] Hosted checkout route exists and returns a redirect URL.
- [x] Checkout success/cancel URLs are derived from the request origin rather than a hard-coded preview host.
- [x] Webhook route exists.
- [x] App-level entitlement checks exist.
- [ ] Durable rate limiting for serverless/multi-instance production. Current in-memory buckets are not a production boundary.
- [ ] Confirm webhook idempotency against the production database.
- [ ] Confirm subscription cancellation/downgrade removes paid entitlement.
- [ ] Confirm each first-wave app has a clean free -> paid -> cancelled lifecycle test.
- [ ] Run deployment smoke test on the production Vercel deployment after the shared gates pass.

## Next implementation milestone

Replace the process-local rate bucket with a durable shared store (database-backed is preferred because VibeCart already uses Neon/Postgres), then add an automated test proving two simulated instances share the same limit.

## Launch rule

A first-wave app is deployment-ready only after checkout, webhook, entitlement, cancellation, and rate-limit behavior are verified end-to-end. Public launch remains a separate decision and is not performed by automation.