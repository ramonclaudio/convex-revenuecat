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

The component exposes 17 query methods via the `RevenueCat` client class. See the main [README](../README.md#query-methods) for the full API reference.

## Supported Webhook Events

All 18 RevenueCat webhook event types are handled:

| Event Type | Description |
|:-----------|:------------|
| `INITIAL_PURCHASE` | New subscription purchased |
| `RENEWAL` | Subscription renewed |
| `CANCELLATION` | Subscription cancelled or refunded |
| `UNCANCELLATION` | Cancelled subscription re-enabled |
| `EXPIRATION` | Subscription expired |
| `BILLING_ISSUE` | Payment method failed |
| `SUBSCRIPTION_PAUSED` | Subscription paused (Android) |
| `SUBSCRIPTION_EXTENDED` | Subscription extended |
| `PRODUCT_CHANGE` | Subscriber changed product |
| `NON_RENEWING_PURCHASE` | One-time purchase |
| `TRANSFER` | Entitlements transferred between users |
| `TEMPORARY_ENTITLEMENT_GRANT` | Temporary access during store outage |
| `REFUND_REVERSED` | Refund was reversed |
| `INVOICE_ISSUANCE` | Invoice issued (Web Billing) |
| `VIRTUAL_CURRENCY_TRANSACTION` | Virtual currency adjustment |
| `EXPERIMENT_ENROLLMENT` | User enrolled in A/B experiment |
| `TEST` | Test event from dashboard |
| `SUBSCRIBER_ALIAS` | Deprecated alias event |

## Key Files

| File | Purpose |
|:-----|:--------|
| `convex.config.ts` | Register with `app.use(revenuecat)` |
| `http.ts` | Mount webhook handler with auth |
| `subscriptions.ts` | Use the `RevenueCat` client class |
