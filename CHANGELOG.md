# Changelog

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
