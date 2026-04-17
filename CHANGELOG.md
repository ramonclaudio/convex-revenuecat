# Changelog

## 0.2.0

### Fixed

- **Refunded users kept access until `EXPIRATION`.** As of 2026 RevenueCat does not emit a distinct `REFUND` event; refunds arrive as `CANCELLATION` with `cancel_reason: "CUSTOMER_SUPPORT"` and/or a negative `price`. The old `processCancellation` only updated `cancelReason` + `autoRenewStatus: false`, leaving entitlements active. Now revokes entitlements when `cancel_reason === "CUSTOMER_SUPPORT"` OR `price < 0`. Checking cancel_reason alone misses Google Play self-serve refunds and dashboard refunds where `cancel_reason` stays `DEVELOPER_INITIATED`. Legacy `processRefund` handler retained defensively for older projects.
- **`autoRenewStatus` was force-set to `false` on every CANCELLATION, including refunds.** Per RC docs, refunds can be issued without deactivating auto-renewal: "refunds can be given without cancelling a subscription." Now `autoRenewStatus` is only forced to `false` for genuine cancellations (UNSUBSCRIBE, BILLING_ERROR, DEVELOPER_INITIATED, PRICE_INCREASE, UNKNOWN). Refund-only cases (CUSTOMER_SUPPORT or negative price) leave the existing value alone so a subsequent RENEWAL arrives truthfully.
- **Handler validators rejected unknown webhook fields.** `eventPayloadValidator` was a strict `v.object`, causing RC's documented "we may add new fields without versioning" path to throw at validation, triggering 5 retries then permanent drop. Handlers now accept `v.any()` and cast to `EventPayload` internally. The validator is retained only as the source of the `EventPayload` TypeScript type. Added a regression test that sends a payload with fields not in the validator.
- **Store enum missing `GALAXY`, `EXTERNAL`, `UNKNOWN_STORE`.** Cross-audit against iOS 5.68.0 (`EntitlementInfo.swift:22-60`) and Android 10.2.0 (`EntitlementInfo.kt:183-289`) confirmed these are live SDK values; Galaxy is already shipping OTP purchases (Android 10.1.0). Our validator would reject a Samsung Galaxy Store customer, an External Purchases API entitlement, or any RC-unknown store. Added all three. Also added `normalizeStore` helper in the HTTP handler that maps the Android wire form `"unknown"` to `UNKNOWN_STORE` before the outer schema validator sees it.
- **`ownership_type` not persisted on entitlements.** Webhooks and REST both carry `ownership_type` (PURCHASED vs FAMILY_SHARED) at the subscription level. Consumers need this at the entitlement level to enforce single-seat products. Added `entitlements.ownershipType` and populate from `event.ownership_type` on every grant/extend/sync. Webhook test added.
- **`refunded_at` not persisted.** When a refund is detected in CANCELLATION, we now set `subscription.refundedAtMs = event.event_timestamp_ms`. `syncSubscriber` also propagates `subscriber.subscriptions[productId].refunded_at`. Audit trail for reporting.
- **`original_purchase_date` not persisted.** Distinct from `purchasedAtMs` (which updates on each renewal). `sync.ts` now stores `originalPurchasedAtMs` from the REST `original_purchase_date` for tenure/loyalty queries.
- **BILLING_ISSUE could convert a lifetime entitlement to finite expiry.** If a lifetime entitlement (`expiresAtMs === undefined`) received a BILLING_ISSUE webhook with `grace_period_expiration_at_ms` set, the old logic `graceEnd && (!ent.expiresAtMs || ...)` treated `undefined` as "needs extension" and set `expiresAtMs = graceEnd`. Low-probability in practice (lifetime products don't receive billing retries) but access-gating wrong in principle — after graceEnd, the previously-lifetime entitlement would start returning `false`. Now guards with `ent.expiresAtMs !== undefined` before extending. Regression test added.
- **`sync.ts` aborted the entire ingest on an unknown `store` value.** If RC introduces a new store before our schema gets bumped, `mapStore` would produce an unknown uppercase value that fails `storeValidator`, throwing the mutation. Now maps unknown values to `UNKNOWN_STORE` (matches the SDK's own `StoreSerializer` default). Regression test added.
- **`isFamilyShare` and `ownershipType` could drift on handler path.** If a webhook arrived with `ownership_type: "FAMILY_SHARED"` but no `is_family_share` field, we stored `isFamilyShare: false` + `ownershipType: "FAMILY_SHARED"` — contradictory. Now derives `isFamilyShare` from `ownership_type` when `is_family_share` is absent. `sync.ts` already derived consistently.
- **Legacy `processRefund` didn't persist `refundedAtMs`.** For symmetry with the CANCELLATION refund path.
- **`billingIssueDetectedAt` short-circuit leaked access indefinitely.** Old `hasEntitlement` returned true whenever the flag was set, regardless of `expiresAtMs`. If `EXPIRATION` failed to arrive after grace, a non-paying user kept access forever. Now mirrors the iOS SDK's `EntitlementInfo.isActive`: pure `expiresAtMs > now`. Grace period is encoded into `expiresAtMs` by `processBillingIssue` (extends entitlement `expiresAtMs` to the `grace_period_expiration_at_ms`) and `sync.ts` (folds `grace_period_expires_date` into the effective expiry). `EXPIRATION` still revokes at grace end; if dropped, access correctly stops at the grace end hard ceiling instead of running forever.
- **`cleanup.webhookEvents` cron capped at 500 deletes/day.** Took the 500 oldest rows, deleted only those past the 30-day cutoff, then returned. Under inflow > 500/day the table grew unboundedly. Now paginates until either cutoff is reached or a per-invocation safety cap (4000) is hit; if more work remains, schedules a continuation immediately instead of waiting 24h.
- **`autoRenewStatus` was set to `undefined` on `RENEWAL`.** A successful renewal implies auto-renew is on; ambiguity is wrong. Now explicitly `true`.
- **`upsertSubscription` silently no-opped on missing required fields.** Added a `console.warn` enumerating the missing fields and the event ID so ops can investigate. Function now returns a boolean.

### Added

- **`deleteCustomer(ctx, { appUserId })`** client method. Purges all component-local rows for a user: customer, subscriptions, entitlements, experiments, invoices, virtual currency balances/transactions, and webhookEvents. Does not call RevenueCat's REST API; pair with `DELETE /v1/subscribers/{app_user_id}` from an action if you also want to purge RC-side (GDPR).
- **`syncSubscriber` hydrates `non_subscriptions`.** One-time/lifetime purchases from `GET /v1/subscribers/{id}` are now ingested into the `subscriptions` table alongside subscriptions. Returns `{ subscriptions, entitlements, nonSubscriptions }`.
- **Experiment upserts run on every event with an `experiments[]` array**, not just purchase events. RC includes the array on every event; mid-cycle re-enrollments are now captured.
- **Transfer/alias/purge operations cap at 500 records per user** to stay under Convex's per-transaction write budget. Pathological accounts throw `TRANSFER_SAFETY_CAP_EXCEEDED` / `PURGE_SAFETY_CAP_EXCEEDED` instead of silently corrupting state.

### Changed

- **Dropped the unused `by_active` index** on the `entitlements` table. No query reads it.
- **Tightened `ClientComponentApi` return types.** Removed `any[]` / `any` from query/mutation references; clients now get proper `Entitlement[]`, `Subscription[]`, `Customer | null`, etc. from the component type definition.
- **Consolidated validators** in `invoices.ts`, `transfers.ts`, `virtualCurrency.ts`, `webhookEvents.ts` to use `schema.tables.X.validator.extend({ _id, _creationTime })` instead of duplicating field lists.
- **README rewrite.** Documents: RC does not sign webhooks (no HMAC, no `X-RevenueCat-Signature`); RC's retry policy (5 retries at 5/10/20/40/80 min, 60s timeout); SUBSCRIBER_ALIAS deprecation status; RC REST API rate limits per domain; GDPR delete flow.

## 0.1.11

### Added

- **Subscriber sync from REST API.** New `syncSubscriber(ctx, { appUserId, subscriber })` method accepts the `subscriber` object from RevenueCat's `GET /v1/subscribers/{app_user_id}` endpoint. Upserts customer, subscriptions, and entitlements to match RevenueCat's source of truth. Covers initial backfill, dropped webhooks, and on-foreground reconciliation. All writes are idempotent.
- **Webhook reconciliation with sync-created records.** `upsertSubscription` falls back to `(appUserId, productId)` lookup when `originalTransactionId` doesn't match, so webhooks arriving after a sync update the existing record instead of creating a duplicate. Patches `originalTransactionId` to the correct value on match.
- **`RevenueCatSubscriber` and `SyncResult` types** exported from the client SDK.

### Changed

- Rewrote README. Dropped mermaid diagram, collapsible sections, and FAQ. Sync docs inline with usage.
- Updated `convex` to 1.34.1, `convex-test` to 0.0.46, `vitest` to 4.1.2, `@vitest/coverage-v8` to 4.1.2, `@convex-dev/eslint-plugin` to 1.2.1, `@types/node` to 25.5.0, `typescript-eslint` to 8.58.0, `pkg-pr-new` to 0.0.66.

### Removed

- Deleted `PUBLISHING.md` (stale template, publishing is handled by GitHub Actions on tag push).

## 0.1.10

### Fixed

- **`aliasEntitlements` dropped `unsubscribeDetectedAt` on merge.** Same hole as `billingIssueDetectedAt` in 0.1.9. The `sourceIsNewer` patch didn't carry `unsubscribeDetectedAt` from the source record. No handler sets it yet, but the field is in the schema and the gap was there. Fixed: same conditional spread pattern as `billingIssueDetectedAt`.

## 0.1.9

### Fixed

- **`REFUND` not handled.** RC sends it when a refund goes through. Was falling through to `"ignored"`. Refunded users kept their entitlements. Added `processRefund`: upserts customer and subscription, revokes entitlements if `entitlement_ids?.length` is set. Same guard as `EXPIRATION`.
- **`aliasEntitlements` dropped `billingIssueDetectedAt` on merge.** The `sourceIsNewer` patch in `SUBSCRIBER_ALIAS` didn't copy `billingIssueDetectedAt` from the source record. Anon user with a billing issue on their ID lost grace-period access after login. Fixed: copies it from source when source has it; leaves destination's value alone otherwise.

## 0.1.8

### Changed

- Updated `convex` to 1.32.0, `typescript-eslint` to 8.56.1, `globals` to 17.4.0, `@types/node` to 24.11.0, `pkg-pr-new` to 0.0.65.
- Pinned `rollup` to `^4.59.0` and `ajv` to `^6.14.0` via overrides to resolve high and moderate audit vulnerabilities in transitive dependencies. Dropped `minimatch` override — `typescript-eslint@8.56.1` switched to `tinyglobby`. 0 vulnerabilities across all severities.

## 0.1.7

### Fixed

- **SUBSCRIBER_ALIAS missing entitlement migration.** `logIn(realId)` updated the customer record but left entitlements under `$RCAnonymousID:xxx`. `hasEntitlement(realId)` returned false until next renewal. Added `aliasEntitlements` to re-assign (or conflict-merge by expiry) all entitlement/subscription records from `original_app_user_id` to `app_user_id`.
- **EXPIRATION revoked all entitlements when `entitlement_ids` was absent.** RC sends null for products not mapped to any entitlement. After transform that became `undefined`, which hit a "revoke everything" path in `revokeEntitlements`. Added `entitlement_ids?.length` guard.
- **RENEWAL and SUBSCRIPTION_EXTENDED silently skipped missing entitlement records.** `extendEntitlements` only patched existing rows. If the record was missing (race condition, prior transfer), user stayed locked out after a successful charge. Added an insert fallback.
- **Virtual currency dedup broken for multi-currency events.** Dedup used `transactionId` alone. A single event can carry adjustments for multiple currencies with the same `transactionId`. Second currency's record was skipped. Added `.filter(currencyCode)`.
- **RENEWAL kept stale cancellation state.** `cancelReason` and `autoRenewStatus` from a prior cancellation cycle weren't cleared on renewal. Both are reset now.
- **Dead `ctx.db.insert` in webhook catch block.** Throwing rolls back the transaction, so the insert was always discarded. Removed it.

## 0.1.6

### Fixed

- **Client type compatibility** — Defined `ClientComponentApi` with explicit function signatures using `"public" | "internal"` visibility union. Convex generates component types with "internal" visibility in consumer apps regardless of how they're defined in the component source.

## 0.1.5

### Fixed

- **Query visibility** — Changed `invoices`, `transfers`, and `virtualCurrency` query functions from `internalQuery` to `query` (public) so they can be accessed via the client SDK.

## 0.1.4

### Added

- **Transfers table** — `TRANSFER` events now store transfer records with `transferredFrom`, `transferredTo`, and `entitlementIds`. Query with `getTransfer()` and `getTransfers()`.
- **Invoices table** — `INVOICE_ISSUANCE` events (Web Billing) now store invoice data including `invoiceId`, `appUserId`, `productId`, pricing. Query with `getInvoice()` and `getInvoices()`.
- **Virtual currency tracking** — `VIRTUAL_CURRENCY_TRANSACTION` events now:
  - Store individual transactions in `virtualCurrencyTransactions` table
  - Maintain running balances in `virtualCurrencyBalances` table
  - Query with `getVirtualCurrencyBalance()`, `getVirtualCurrencyBalances()`, `getVirtualCurrencyTransactions()`
- **`ownership_type` field** — Subscriptions now track `PURCHASED` vs `FAMILY_SHARED` to distinguish direct purchases from Family Sharing. Available in schema, handlers, and exported types.
- **Grace period queries** — New `isInGracePeriod(originalTransactionId)` and `getSubscriptionsInGracePeriod(appUserId)` methods to check if subscriptions are in billing retry period. Per RevenueCat docs, users should retain access during grace period.
- **Subscription transfer on TRANSFER** — `TRANSFER` events now update `appUserId` on subscriptions table, not just entitlements. Ensures `getSubscriptions(appUserId)` returns transferred subscriptions.

### Fixed

- **TRANSFER handler missing customer upsert** — Source and destination users are now properly upserted to customers table.
- **Webhook validation fails for undocumented RevenueCat fields** — Added `takehome_percentage` and `entitlement_id` to event payload validator.
- **INVOICE_ISSUANCE uses event.id** — The handler was looking for a nonexistent `invoice_id` field. Now correctly uses the event's `id` as the invoice identifier per RevenueCat sample events.
- **Component type generation** — Changed `transfers`, `invoices`, and `virtualCurrency` queries from `internalQuery` to `query` so Convex generates proper types for consumer apps.

### Changed

- **Typed `adjustments` field** — Virtual currency adjustments now have proper typing: `{ amount: number, currency: { code, name, description? } }[]` instead of `v.any()`.
- **Added `enrolled_at_ms` field** — Top-level field for `EXPERIMENT_ENROLLMENT` events.
- **Added documentation comments** — Deprecated fields and field purposes now have inline comments.
- **Auth header handling** — Now supports both raw token and `Bearer <token>` formats. Uses constant-time comparison to prevent timing attacks.

## 0.1.3

### Fixed

- **Client type compatibility** — Changed `ComponentApi` to `ClientComponentApi` using `Pick<>` to only require the specific methods the client uses. Fixes type errors when deployments have different component versions.

## 0.1.2

### Changed

- **Removed node:crypto dependency** — Webhook auth now uses simple string comparison instead of `timingSafeEqual`. Convex runtime doesn't support node:crypto, and timing attacks are mitigated by rate limiting + random 32-byte secrets.

## 0.1.1

### Fixed

- **Webhook processing fails with null values** — RevenueCat sends explicit `null` for optional fields, but Convex's `v.optional()` expects absent keys (not null values). Object keys with null values are now removed, making them absent. Array elements are preserved since `null` is a valid Convex value (unlike `undefined` which is not).
- **Bundling fails in non-Node environments** — Top-level `node:crypto` import caused bundlers to fail. Now lazily imported only when webhook auth is configured.

### Changed

- Merged `stripNulls` and `encodeReservedKeys` into single `transformPayload` function for cleaner, single-pass payload processing.

## 0.1.0

- Webhook processing for all 18 RevenueCat event types
- Customer, subscription, entitlement, and experiment tracking
- Idempotent event processing with deduplication
- Rate limiting (100 req/min per app)
- Webhook event audit log with 30-day retention
- Client SDK with 8 query methods and HTTP webhook handler
- Test helpers for convex-test integration
- 113 tests
