# Example App

This directory contains an example Convex backend demonstrating the RevenueCat component.

## Structure

```
example/
└── convex/
    ├── convex.config.ts   # Registers the component
    ├── http.ts            # Mounts webhook handler
    ├── subscriptions.ts   # Example queries using all APIs
    └── *.test.ts          # Integration tests
```

## Setup

1. Set your webhook auth secret:
   ```bash
   npx convex env set REVENUECAT_WEBHOOK_AUTH "your-secret-value"
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

The `RevenueCat` client class exposes 19 query and mutation methods. See the main [README](../README.md#api) for the full reference.

Lifecycle hooks (`onEntitlementActivated`, `onEntitlementDeactivated`, `onCustomerDeleted`) and the `deleteCustomer` GDPR purge landed in 0.2.0. See the main README's [Lifecycle hooks](../README.md#lifecycle-hooks) section.

## Supported Webhook Events

17 canonical RevenueCat event types plus 2 legacy (`REFUND`, `SUBSCRIBER_ALIAS`) are handled:

| Event Type | Description |
|:-----------|:------------|
| `INITIAL_PURCHASE` | New subscription purchased |
| `RENEWAL` | Subscription renewed |
| `CANCELLATION` | Kept until `EXPIRATION`, except refunds (`cancel_reason: "CUSTOMER_SUPPORT"` OR `price < 0`) which revoke immediately |
| `UNCANCELLATION` | Cancelled subscription re-enabled |
| `EXPIRATION` | Subscription expired |
| `BILLING_ISSUE` | Payment failed; grace folded into `expiresAtMs` |
| `SUBSCRIPTION_PAUSED` | Paused (Android); does not revoke |
| `SUBSCRIPTION_EXTENDED` | Subscription extended |
| `PRODUCT_CHANGE` | Subscriber changed product |
| `NON_RENEWING_PURCHASE` | One-time purchase |
| `TRANSFER` | Entitlements moved between users |
| `TEMPORARY_ENTITLEMENT_GRANT` | Temp access during store outage |
| `REFUND_REVERSED` | Refund was reversed; entitlements restored |
| `INVOICE_ISSUANCE` | Invoice issued (Web Billing) |
| `VIRTUAL_CURRENCY_TRANSACTION` | Virtual currency adjustment |
| `EXPERIMENT_ENROLLMENT` | User enrolled in A/B experiment |
| `TEST` | Test event from dashboard |
| `REFUND` *(legacy)* | As of 2026 refunds arrive as `CANCELLATION`; handler retained for older projects |
| `SUBSCRIBER_ALIAS` *(legacy)* | Deprecated; new projects receive `TRANSFER` |

## Key Files

| File | Purpose |
|:-----|:--------|
| `convex.config.ts` | Register with `app.use(revenuecat)` |
| `http.ts` | Mount webhook handler with auth |
| `subscriptions.ts` | Use the `RevenueCat` client class |
