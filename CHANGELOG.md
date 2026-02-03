# Changelog

## 0.1.1

### Fixed

- **Webhook processing fails with null values** — RevenueCat sends explicit `null` for optional fields, but Convex validators only accept `undefined`. Payloads are now sanitized before processing.
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
