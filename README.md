# Convex RevenueCat Component

A [Convex](https://convex.dev) component for [RevenueCat](https://www.revenuecat.com) subscription management. Receives webhooks, stores subscription/entitlement state, and provides reactive queries for access control.

## Features

- **Webhook Processing**: Idempotent handling of all 18 RevenueCat webhook events
- **Reactive Queries**: Real-time entitlement and subscription state
- **Correct Edge Cases**: Handles cancellation, pause, expiration, and transfer events properly
- **RevenueCat API Integration**: Full REST API support (entitlements, customers, offerings)
- **Subscriber Attributes**: Stores and merges customer attributes from webhooks
- **Experiment Tracking**: Tracks A/B test enrollments from RevenueCat experiments
- **Type-Safe**: Full TypeScript support with exported types

## Installation

```bash
npm install convex-revenuecat-component
```

## Setup

### 1. Configure the Component

Create or update `convex/convex.config.ts`:

```typescript
import { defineApp } from "convex/server";
import revenuecat from "convex-revenuecat-component/convex.config";

const app = defineApp();
app.use(revenuecat);

export default app;
```

### 2. Mount the Webhook Handler

Create or update `convex/http.ts`:

```typescript
import { httpRouter } from "convex/server";
import { RevenueCat } from "convex-revenuecat-component";
import { components } from "./_generated/api";

const http = httpRouter();

const revenuecat = new RevenueCat(components.revenuecat, {
  // Optional: Verify webhook authorization header
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

In your RevenueCat project settings:

1. Go to **Integrations** → **Webhooks**
2. Add your Convex deployment URL: `https://your-deployment.convex.site/webhooks/revenuecat`
3. Optionally set an **Authorization header** value and add it to your Convex environment variables

## Usage

### Check Entitlements

```typescript
import { query } from "./_generated/server";
import { components } from "./_generated/api";
import { RevenueCat } from "convex-revenuecat-component";
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

### RevenueCat Class

```typescript
const revenuecat = new RevenueCat(components.revenuecat, {
  // Secret API key for API calls (grant/revoke entitlements, fetch customer)
  REVENUECAT_API_KEY?: string,

  // Project ID - required for getCustomerFromApi
  REVENUECAT_PROJECT_ID?: string,

  // Webhook authorization header for verifying incoming webhooks
  REVENUECAT_WEBHOOK_AUTH?: string,
});
```

Get your API key from: RevenueCat Dashboard → Project Settings → API Keys

### Query Methods

| Method | Description |
|--------|-------------|
| `hasEntitlement(ctx, { appUserId, entitlementId })` | Check if user has active entitlement |
| `getActiveEntitlements(ctx, { appUserId })` | Get all active entitlements |
| `getAllEntitlements(ctx, { appUserId })` | Get all entitlements (active and inactive) |
| `getActiveSubscriptions(ctx, { appUserId })` | Get all active subscriptions |
| `getAllSubscriptions(ctx, { appUserId })` | Get all subscriptions |
| `getCustomer(ctx, { appUserId })` | Get customer record |

### Mutation Methods (Local Database)

| Method | Description |
|--------|-------------|
| `grantEntitlement(ctx, args)` | Grant entitlement locally |
| `revokeEntitlement(ctx, args)` | Revoke entitlement locally |

### Action Methods (RevenueCat API)

| Method | Description |
|--------|-------------|
| `grantEntitlementViaApi(ctx, args)` | Grant promotional entitlement |
| `revokeEntitlementViaApi(ctx, args)` | Revoke promotional entitlement |
| `getCustomerFromApi(ctx, { appUserId })` | Fetch customer data (requires projectId) |
| `deleteCustomerViaApi(ctx, { appUserId })` | Delete customer (GDPR compliance) |
| `updateAttributesViaApi(ctx, args)` | Update customer attributes |
| `getOfferingsViaApi(ctx, args)` | Get offerings for server-rendered paywalls |

## Webhook Events

The component handles all 18 RevenueCat webhook events:

| Event | Behavior |
|-------|----------|
| `INITIAL_PURCHASE` | Creates subscription, grants entitlements |
| `RENEWAL` | Extends entitlement expiration |
| `CANCELLATION` | **Keeps** entitlements until expiration |
| `EXPIRATION` | **Revokes** entitlements |
| `BILLING_ISSUE` | Keeps entitlements during grace period |
| `SUBSCRIPTION_PAUSED` | **Does not** revoke entitlements |
| `SUBSCRIPTION_EXTENDED` | Extends expiration (customer support) |
| `TRANSFER` | Moves entitlements between users |
| `UNCANCELLATION` | Clears cancellation status |
| `PRODUCT_CHANGE` | Updates subscription product (informational) |
| `NON_RENEWING_PURCHASE` | Grants entitlements for one-time purchase |
| `TEMPORARY_ENTITLEMENT_GRANT` | Grants temp access during store outage |
| `REFUND_REVERSED` | Restores entitlements after refund undone |
| `TEST` | Dashboard test event (logged only) |
| `INVOICE_ISSUANCE` | Web Billing invoice created (logged) |
| `VIRTUAL_CURRENCY_TRANSACTION` | Virtual currency adjustment (logged) |
| `EXPERIMENT_ENROLLMENT` | A/B test enrollment (tracked) |
| `SUBSCRIBER_ALIAS` | User alias created (deprecated, logged) |

## Database Schema

The component creates five tables:

- **customers**: User identity, aliases, and subscriber attributes
- **subscriptions**: Purchase records with product and payment details
- **entitlements**: Access control state (active/inactive, expiration)
- **experiments**: A/B test enrollments from RevenueCat experiments
- **webhookEvents**: Event log for idempotency and debugging

## Testing

Register the component in your tests using the provided helper:

```typescript
import { convexTest } from "convex-test";
import revenuecatTest from "convex-revenuecat-component/test";

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

Apache-2.0
