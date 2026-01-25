# Convex RevenueCat

[![npm version](https://img.shields.io/npm/v/convex-revenuecat)](https://www.npmjs.com/package/convex-revenuecat)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)

A [Convex](https://convex.dev) component for [RevenueCat](https://www.revenuecat.com) subscription management. Receives webhooks, stores subscription/entitlement state, and provides reactive queries for access control.

## Features

- **Webhook Processing** — Idempotent handling of all 18 RevenueCat webhook events
- **Reactive Queries** — Real-time entitlement and subscription state
- **Correct Edge Cases** — Handles cancellation, pause, expiration, and transfer events properly
- **RevenueCat API Integration** — Full REST API support (entitlements, customers, offerings)
- **Subscriber Attributes** — Stores and merges customer attributes from webhooks
- **Experiment Tracking** — Tracks A/B test enrollments from RevenueCat experiments
- **Type-Safe** — Full TypeScript support with exported types

## Installation

```bash
npm install convex-revenuecat
```

## Quick Start

### 1. Configure the Component

```typescript
// convex/convex.config.ts
import { defineApp } from "convex/server";
import revenuecat from "convex-revenuecat/convex.config";

const app = defineApp();
app.use(revenuecat);

export default app;
```

### 2. Mount the Webhook Handler

```typescript
// convex/http.ts
import { httpRouter } from "convex/server";
import { RevenueCat } from "convex-revenuecat";
import { components } from "./_generated/api";

const http = httpRouter();

const revenuecat = new RevenueCat(components.revenuecat, {
  REVENUECAT_WEBHOOK_AUTH: process.env.REVENUECAT_WEBHOOK_AUTH,
});

http.route({
  path: "/webhooks/revenuecat",
  method: "POST",
  handler: revenuecat.httpHandler(),
});

export default http;
```

### 3. Configure RevenueCat Dashboard

1. Go to **Integrations** → **Webhooks**
2. Add your Convex deployment URL: `https://your-deployment.convex.site/webhooks/revenuecat`
3. Set an **Authorization header** value and add it to your Convex environment variables

> [!TIP]
> Use the RevenueCat dashboard's "Send Test Event" button to verify your webhook is working.

## Usage

### Check Entitlements

```typescript
import { query } from "./_generated/server";
import { components } from "./_generated/api";
import { RevenueCat } from "convex-revenuecat";
import { v } from "convex/values";

const revenuecat = new RevenueCat(components.revenuecat);

export const checkPremium = query({
  args: { appUserId: v.string() },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    return await revenuecat.hasEntitlement(ctx, {
      appUserId: args.appUserId,
      entitlementId: "premium",
    });
  },
});
```

### Get Active Subscriptions

```typescript
export const getSubscriptions = query({
  args: { appUserId: v.string() },
  handler: async (ctx, args) => {
    return await revenuecat.getActiveSubscriptions(ctx, {
      appUserId: args.appUserId,
    });
  },
});
```

### Grant Promotional Entitlements

```typescript
import { action } from "./_generated/server";

const revenuecat = new RevenueCat(components.revenuecat, {
  REVENUECAT_API_KEY: process.env.REVENUECAT_API_KEY,
});

export const grantTrial = action({
  args: { appUserId: v.string() },
  handler: async (ctx, args) => {
    await revenuecat.grantEntitlementViaApi(ctx, {
      appUserId: args.appUserId,
      entitlementId: "premium",
      duration: "weekly",
    });
  },
});
```

## API Reference

### Constructor Options

```typescript
const revenuecat = new RevenueCat(components.revenuecat, {
  REVENUECAT_API_KEY?: string,      // Secret API key for API calls
  REVENUECAT_PROJECT_ID?: string,   // Required for getCustomerFromApi
  REVENUECAT_WEBHOOK_AUTH?: string, // Webhook authorization header
});
```

> [!NOTE]
> Get your API key from: **RevenueCat Dashboard** → **Project Settings** → **API Keys**

### Query Methods

| Method | Description |
|:-------|:------------|
| `hasEntitlement(ctx, { appUserId, entitlementId })` | Check if user has active entitlement |
| `getActiveEntitlements(ctx, { appUserId })` | Get all active entitlements |
| `getAllEntitlements(ctx, { appUserId })` | Get all entitlements (active and inactive) |
| `getActiveSubscriptions(ctx, { appUserId })` | Get all active subscriptions |
| `getAllSubscriptions(ctx, { appUserId })` | Get all subscriptions |
| `getCustomer(ctx, { appUserId })` | Get customer record |

### Mutation Methods

| Method | Description |
|:-------|:------------|
| `grantEntitlement(ctx, args)` | Grant entitlement locally |
| `revokeEntitlement(ctx, args)` | Revoke entitlement locally |

### Action Methods (RevenueCat API)

| Method | Description |
|:-------|:------------|
| `grantEntitlementViaApi(ctx, args)` | Grant promotional entitlement |
| `revokeEntitlementViaApi(ctx, args)` | Revoke promotional entitlement |
| `getCustomerFromApi(ctx, { appUserId })` | Fetch customer data |
| `deleteCustomerViaApi(ctx, { appUserId })` | Delete customer (GDPR) |
| `updateAttributesViaApi(ctx, args)` | Update customer attributes |
| `getOfferingsViaApi(ctx, args)` | Get offerings for paywalls |

## Webhook Events

<details>
<summary><strong>View all 18 supported webhook events</strong></summary>

| Event | Behavior |
|:------|:---------|
| `INITIAL_PURCHASE` | Creates subscription, grants entitlements |
| `RENEWAL` | Extends entitlement expiration |
| `CANCELLATION` | **Keeps** entitlements until expiration |
| `EXPIRATION` | **Revokes** entitlements |
| `BILLING_ISSUE` | Keeps entitlements during grace period |
| `SUBSCRIPTION_PAUSED` | **Does not** revoke entitlements |
| `SUBSCRIPTION_EXTENDED` | Extends expiration (customer support) |
| `TRANSFER` | Moves entitlements between users |
| `UNCANCELLATION` | Clears cancellation status |
| `PRODUCT_CHANGE` | Updates subscription product |
| `NON_RENEWING_PURCHASE` | Grants entitlements for one-time purchase |
| `TEMPORARY_ENTITLEMENT_GRANT` | Grants temp access during store outage |
| `REFUND_REVERSED` | Restores entitlements after refund undone |
| `TEST` | Dashboard test event (logged only) |
| `INVOICE_ISSUANCE` | Web Billing invoice created |
| `VIRTUAL_CURRENCY_TRANSACTION` | Virtual currency adjustment |
| `EXPERIMENT_ENROLLMENT` | A/B test enrollment (tracked) |
| `SUBSCRIBER_ALIAS` | User alias created (deprecated) |

</details>

> [!IMPORTANT]
> `CANCELLATION` does **not** revoke entitlements — users keep access until `EXPIRATION`.

## Database Schema

The component creates five tables:

| Table | Purpose |
|:------|:--------|
| `customers` | User identity, aliases, and subscriber attributes |
| `subscriptions` | Purchase records with product and payment details |
| `entitlements` | Access control state (active/inactive, expiration) |
| `experiments` | A/B test enrollments from RevenueCat experiments |
| `webhookEvents` | Event log for idempotency and debugging |

## Testing

Register the component in your tests:

```typescript
import { convexTest } from "convex-test";
import revenuecatTest from "convex-revenuecat/test";

function initConvexTest() {
  const t = convexTest();
  revenuecatTest.register(t);
  return t;
}

test("check premium access", async () => {
  const t = initConvexTest();
  // Your test code here
});
```

## Development

```bash
npm install
npm run dev        # Start development server
npm run test       # Run tests (89 tests)
npm run build      # Build for production
```

## License

[Apache-2.0](LICENSE)
