# Tenant isolation verification — 2026-10-19

## Conclusion

Current application predicates are insufficient for a shared merchant database. Keep the pilot locked. No RLS, grants, credentials, production settings or real Neon data were changed. A database enforcement boundary is needed before colocating merchant tenants: RLS with authenticated transaction-scoped tenant context, or separate merchant databases/roles with no cross-merchant access. RLS must accompany application fixes; enabling policies on today's query flow breaks legitimate cart creation and reads.

The dedicated temporary database reduces the pilot's blast radius but does not demonstrate tenant isolation. Do not onboard a second merchant into this database under the current shared runtime role.

## Independent database facts

Owner-run verifier output inspected locally: project royal-mountain-93927396, independent branch br-damp-scene-b4ewajhs, endpoint ep-blue-hill-b46430js. PostgreSQL independently reports neon.endpoint_id=ep-blue-hill-b46430js, database neondb, current/session role vibecart_pilot_runtime, transaction_read_only=on. No superuser, CREATEDB, CREATEROLE, replication, BYPASSRLS, memberships, public schema CREATE, database CREATE, TRUNCATE, TRIGGER or executable public security-definer functions. TEMP privilege remains. Six tables grant SELECT/INSERT/UPDATE/DELETE, all RLS disabled, zero policies.

## Table-by-table review

| Table | Enforcement found | Gaps |
|---|---|---|
| vibecart_carts | merchant predicates on read/update/cancel/conversion; merchant-key/HMAC capability checks at cart checkout; idempotency indexed by merchant | Low-level creation accepts an explicit merchant; no SQL role fence. |
| vibecart_orders | hosted webhook rejects foreign session metadata before normalization; checkout resolves the configured merchant's cart | ID/session lookup, list and fulfillment update lack merchant predicates. Checkout-session conflict upsert can overwrite a foreign tenant's fields. |
| vibecart_order_lines | parent order_id FK and atomic payment transaction | No merchant column/policy; unscoped parent lookup exposes lines and conflicting session replay updates them. |
| vibecart_order_events | parent FK and unique event ID | Fulfillment and replay can append to a foreign order; globally unique event IDs do not establish merchant ownership. |
| vibecart_cloud_outbox | lease ownership fencing; claimed row merchant must match fetched order merchant | Immediate claim and due/retry drain lack configured-merchant scope. Row/order agreeing with each other does not establish ownership by this deployment. Single configured Cloud destination can receive another tenant's order. |
| vibecart_rate_limits | key hash includes merchant/scope/client; normal counters separate tenants | No merchant column or database policy; cleanup is global. Separate privileged maintenance from merchant runtime before shared tenancy. |

Cloud integration authentication validates its configured integration ID and key but its order lookup does not validate order.merchantId. An actual route test returned merchant B's order to an authorized merchant A integration. Preview currently disables this route and Cloud delivery, so this finding is not a claim of a public exploit on the locked Preview.

## Negative tests

Actual TypeScript modules and actual SQL ran against local in-memory PostgreSQL (PGlite), with both synthetic merchants. No remote DB connection or network delivery was used. Seven negative controls passed: foreign cart read/cancel/replace rejected; foreign checkout returned 404 with zero payment handoffs; merchant-B HMAC token rejected under A; foreign hosted webhook rejected before normalization/storage; rate-limit buckets separated.

Eight isolation expectations failed: order lookup by ID, lookup by session, list, fulfillment/event mutation, immediate outbox, retry drain, conflicting checkout replay, and the actual authenticated integration lookup route. A ninth compatibility expectation failed: a transaction-local RLS prototype hid a legitimate cart and rejected a legitimate cart insert because current modules establish no database tenant context. The prototype was rolled back locally; no Neon policy was enabled.

These are deliberate failing security probes, not a claim that CI failed. Normal CI regression counts are separate. Detailed sanitized observed results are saved outside Git in TENANT_ISOLATION_NEGATIVE_RESULTS.json.

## Required engineering before shared merchant data

Scope all order reads/mutations, session conflicts and outbox claims to an authenticated merchant; reject foreign-session conflicts before any child/event/outbox writes and preserve atomic rollback. Bind integration identity to merchant ownership. Preserve global uniqueness only where intentional while rejecting cross-merchant collisions. Enforce child ownership via parent joins/composite constraints. Design tenant context inside each transaction (Neon HTTP/pooling does not preserve a prior standalone SET across queries). Keep global maintenance in a separately authorized service context. Add two-merchant integration tests with scoped runtime role, then evaluate RLS and full checkout/replay/outage behavior offline before proposing a staging migration.

## Runtime and credential checks

Local/control-plane database proof is not proof of deployed runtime binding. The Preview diagnostic must still be authenticated and its returned endpoint, current role, database, commit and read-only flag compared with independent evidence. The form keeps credentials out of URLs and performs only SELECTs under the unchanged false lock.

Before payment testing, rotate only the temporary runtime password and branch-specific Preview DATABASE_URL, merchant key and cart signing secret; preserve privileges, keep the lock false, redeploy and invalidate old staging credentials/capabilities. Never reuse the earlier readable values for checkout. No rotation was applied during verification.
