# Example App

This directory contains an example Convex backend demonstrating the RevenueCat component.

## Structure

```
example/
└── convex/
    ├── convex.config.ts   # Registers the component
    ├── http.ts            # Mounts webhook handler via registerRoutes
    ├── subscriptions.ts   # Identity-aware queries (auth via ctx.auth)
    ├── http.test.ts       # End-to-end HTTP tests
    └── example.test.ts    # Integration tests using withIdentity
```

`subscriptions.ts` spreads `revenuecat.api()` to expose every user-scoped query under one auth-aware factory. Each handler derives `appUserId` from `ctx.auth.getUserIdentity().subject` server-side. A small `checkPremium` follows to demonstrate the manual auth pattern when you want a tier-specific named query. The companion tests use `t.withIdentity({ subject })` to provide auth context. Copying this pattern into your own app is the safe default, accepting `appUserId` from clients is an IDOR.

## Setup

1. Generate and set your webhook auth secret (32+ chars):
   ```bash
   openssl rand -base64 32
   npx convex env set REVENUECAT_WEBHOOK_AUTH "your-generated-secret"
   ```

2. Configure RevenueCat Dashboard:
   - Go to **Integrations** → **Webhooks**
   - Set webhook URL: `https://your-deployment.convex.site/webhooks/revenuecat`
   - Set **Authorization header** to match your `REVENUECAT_WEBHOOK_AUTH`

## Running

From the repo root:

```bash
npm run dev    # Starts Convex dev server
npm run test   # Runs all tests
```

## Public APIs

The `RevenueCat` client class exposes 28 query and mutation methods plus `api()` and `registerRoutes()` helpers. `api()` returns identity-aware handlers for every user-scoped query. See the main [README](../README.md#api) for the full reference.

Lifecycle hooks (`onEntitlementActivated`, `onEntitlementDeactivated`, `onCustomerDeleted`) and the `deleteCustomer` GDPR purge are documented in the main README's [Lifecycle hooks](../README.md#lifecycle-hooks) section. The 0.3.0 security/correctness fixes (auth secret floor, IDOR-safe `api()` factory covering every user-scoped query, `transferParticipants` join for purge, `kind` discriminator with `subscriptions.backfillKind` migration, country/management-url mirror, monotonic `lastSeenAt`, etc.) are in the [CHANGELOG](../CHANGELOG.md).

## Supported Webhook Events

17 canonical RevenueCat event types plus 2 legacy (`REFUND`, `SUBSCRIBER_ALIAS`) are handled:

| Event Type | Description |
|:-----------|:------------|
| `INITIAL_PURCHASE` | New subscription purchased |
| `RENEWAL` | Subscription renewed |
| `CANCELLATION` | Kept until `EXPIRATION`, except refunds (`cancel_reason: "CUSTOMER_SUPPORT"` OR `price < 0`) which revoke immediately |
| `UNCANCELLATION` | Cancelled subscription re-enabled |
| `EXPIRATION` | Subscription expired |
| `BILLING_ISSUE` | Payment failed, grace folded into `expiresAtMs` |
| `SUBSCRIPTION_PAUSED` | Paused (Android), does not revoke |
| `SUBSCRIPTION_EXTENDED` | Subscription extended |
| `PRODUCT_CHANGE` | Subscriber changed product |
| `NON_RENEWING_PURCHASE` | One-time purchase (stored with `kind: "consumable"`) |
| `TRANSFER` | Entitlements moved between users |
| `TEMPORARY_ENTITLEMENT_GRANT` | Temp access during store outage |
| `REFUND_REVERSED` | Refund was reversed, entitlements restored |
| `INVOICE_ISSUANCE` | Invoice issued (Web Billing) |
| `VIRTUAL_CURRENCY_TRANSACTION` | Virtual currency adjustment |
| `EXPERIMENT_ENROLLMENT` | User enrolled in A/B experiment |
| `TEST` | Test event from dashboard |
| `REFUND` *(legacy)* | As of 2026 refunds arrive as `CANCELLATION`. Handler retained for older projects |
| `SUBSCRIBER_ALIAS` *(legacy)* | Deprecated. New projects receive `TRANSFER` |

## Key Files

| File | Purpose |
|:-----|:--------|
| `convex.config.ts` | Register with `app.use(revenuecat)` |
| `http.ts` | Mount webhook handler via `revenuecat.registerRoutes(http)` |
| `subscriptions.ts` | Spread of `revenuecat.api()` plus a `checkPremium` example using the manual auth pattern |
| `http.test.ts` | End-to-end auth, payload-validation, and rate-limit tests via `t.fetch` |
| `example.test.ts` | Subscription/entitlement query tests using `t.withIdentity` |
