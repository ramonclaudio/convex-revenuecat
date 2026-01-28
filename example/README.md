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

The component exposes 9 methods via the `RevenueCat` client class:

### Entitlements

| Method | Description |
|:-------|:------------|
| `hasEntitlement(ctx, { appUserId, entitlementId })` | Check if user has specific entitlement |
| `getActiveEntitlements(ctx, { appUserId })` | Get all active entitlements |
| `getAllEntitlements(ctx, { appUserId })` | Get all entitlements (including expired) |

### Subscriptions

| Method | Description |
|:-------|:------------|
| `getActiveSubscriptions(ctx, { appUserId })` | Get all active subscriptions |
| `getAllSubscriptions(ctx, { appUserId })` | Get all subscriptions (including expired) |

### Customers

| Method | Description |
|:-------|:------------|
| `getCustomer(ctx, { appUserId })` | Get customer record |

### Experiments (A/B Testing)

| Method | Description |
|:-------|:------------|
| `getExperiment(ctx, { appUserId, experimentId })` | Get user's variant for specific experiment |
| `getExperiments(ctx, { appUserId })` | Get all experiments user is enrolled in |

### HTTP Handler

| Method | Description |
|:-------|:------------|
| `httpHandler()` | Returns HTTP action for webhook endpoint |

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
