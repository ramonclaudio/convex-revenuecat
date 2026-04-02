# convex-revenuecat

[![npm](https://img.shields.io/npm/v/convex-revenuecat)](https://www.npmjs.com/package/convex-revenuecat)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)

I use RevenueCat for in-app purchases and Convex for everything else. Needed a way to check entitlements server-side without hitting RevenueCat's API on every request. So I built a Convex component that receives RevenueCat webhooks and keeps subscription state in your database. Query it like any other Convex table, get real-time reactivity for free.

Handles all 18 webhook event types, deduplicates by event ID, and gets the edge cases right (cancellation keeps access until expiration, pause doesn't revoke, grace periods stay active).

This is not a replacement for the [RevenueCat SDK](https://www.revenuecat.com/docs/getting-started/installation). Use their SDK client-side for purchases. This handles the server-side state.

## Install

```bash
npm install convex-revenuecat
```

Requires Convex `>=1.31.6`.

## Setup

### 1. Register the component

```typescript
// convex/convex.config.ts
import { defineApp } from "convex/server";
import revenuecat from "convex-revenuecat/convex.config";

const app = defineApp();
app.use(revenuecat);

export default app;
```

### 2. Mount the webhook handler

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

### 3. Set the env variable

```bash
openssl rand -base64 32
npx convex env set REVENUECAT_WEBHOOK_AUTH "your-generated-secret"
```

### 4. Configure RevenueCat

In the [RevenueCat Dashboard](https://app.revenuecat.com), go to Project Settings > Integrations > Webhooks > + New:

- Webhook URL: `https://<your-deployment>.convex.site/webhooks/revenuecat`
- Authorization header: the secret from step 3

Hit "Send Test Event" and check `npx convex logs` to confirm.

## Usage

```typescript
// convex/revenuecat.ts
import { RevenueCat } from "convex-revenuecat";
import { components } from "./_generated/api";

export const revenuecat = new RevenueCat(components.revenuecat, {
  REVENUECAT_WEBHOOK_AUTH: process.env.REVENUECAT_WEBHOOK_AUTH,
});
```

### Check entitlements

```typescript
import { query } from "./_generated/server";
import { revenuecat } from "./revenuecat";
import { v } from "convex/values";

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

### Sync from REST API

Webhooks can be delayed or dropped. `syncSubscriber` pulls a subscriber's current state from RevenueCat's API and reconciles it with the database. All writes are idempotent, no duplicates.

```typescript
import { action } from "./_generated/server";
import { revenuecat } from "./revenuecat";
import { v } from "convex/values";

export const syncUser = action({
  args: { appUserId: v.string() },
  handler: async (ctx, args) => {
    const res = await fetch(
      `https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(args.appUserId)}`,
      { headers: { Authorization: `Bearer ${process.env.REVENUECAT_API_KEY}` } },
    );
    if (!res.ok) throw new Error(`RevenueCat API: ${res.status}`);
    const data = await res.json();
    return await revenuecat.syncSubscriber(ctx, {
      appUserId: args.appUserId,
      subscriber: data.subscriber,
    });
  },
});
```

Call on app foreground, after purchases, or on a schedule. Requires a **secret** API key (not the public SDK key) set as `REVENUECAT_API_KEY` in your Convex environment.

## API

All query methods return empty arrays or `null` for missing users (never throw). Lifetime purchases without `expirationAtMs` are always considered active.

| Method | Returns |
|:-------|:--------|
| `hasEntitlement(ctx, { appUserId, entitlementId })` | `boolean` |
| `getActiveEntitlements(ctx, { appUserId })` | `Entitlement[]` |
| `getAllEntitlements(ctx, { appUserId })` | `Entitlement[]` |
| `getActiveSubscriptions(ctx, { appUserId })` | `Subscription[]` |
| `getAllSubscriptions(ctx, { appUserId })` | `Subscription[]` |
| `isInGracePeriod(ctx, { originalTransactionId })` | `GracePeriodStatus` |
| `getSubscriptionsInGracePeriod(ctx, { appUserId })` | `Subscription[]` |
| `getCustomer(ctx, { appUserId })` | `Customer \| null` |
| `getExperiment(ctx, { appUserId, experimentId })` | `Experiment \| null` |
| `getExperiments(ctx, { appUserId })` | `Experiment[]` |
| `getTransfer(ctx, { eventId })` | `Transfer \| null` |
| `getTransfers(ctx, { limit? })` | `Transfer[]` |
| `getInvoice(ctx, { invoiceId })` | `Invoice \| null` |
| `getInvoices(ctx, { appUserId })` | `Invoice[]` |
| `getVirtualCurrencyBalance(ctx, { appUserId, currencyCode })` | `VirtualCurrencyBalance \| null` |
| `getVirtualCurrencyBalances(ctx, { appUserId })` | `VirtualCurrencyBalance[]` |
| `getVirtualCurrencyTransactions(ctx, { appUserId, currencyCode? })` | `VirtualCurrencyTransaction[]` |
| `syncSubscriber(ctx, { appUserId, subscriber })` | `SyncResult` |

## Webhook Events

All 18 RevenueCat event types handled:

| Event | What happens |
|:------|:-------------|
| `INITIAL_PURCHASE` | Creates subscription, grants entitlements |
| `RENEWAL` | Extends expiration |
| `CANCELLATION` | Keeps access until expiration |
| `EXPIRATION` | Revokes entitlements |
| `BILLING_ISSUE` | Keeps entitlements during grace period |
| `SUBSCRIPTION_PAUSED` | Does not revoke |
| `SUBSCRIPTION_EXTENDED` | Extends expiration |
| `TRANSFER` | Moves entitlements between users |
| `UNCANCELLATION` | Clears cancellation status |
| `PRODUCT_CHANGE` | Updates product on subscription |
| `NON_RENEWING_PURCHASE` | Grants entitlements for one-time purchase |
| `TEMPORARY_ENTITLEMENT_GRANT` | Temp access during store outage |
| `REFUND` | Revokes entitlements immediately |
| `REFUND_REVERSED` | Restores entitlements |
| `TEST` | Logged only |
| `INVOICE_ISSUANCE` | Invoice created (Web Billing) |
| `VIRTUAL_CURRENCY_TRANSACTION` | Currency adjustment |
| `EXPERIMENT_ENROLLMENT` | A/B test enrollment tracked |
| `SUBSCRIBER_ALIAS` | Migrates data from anonymous to real user ID |

`CANCELLATION` does NOT revoke entitlements. Users keep access until `EXPIRATION`. This trips people up.

## Limitations

- No automatic backfill. Existing subscribers before webhook setup won't appear until they trigger a new event or you call `syncSubscriber` for each user.
- Raw payloads stored for debugging. May contain subscriber attributes. Auto-deleted after 30 days.
- Rate limited at 100 req/min per app. Built-in, no config needed.

## Testing

```typescript
import { convexTest } from "convex-test";
import revenuecatTest from "convex-revenuecat/test";

function initConvexTest() {
  const t = convexTest();
  revenuecatTest.register(t);
  return t;
}
```

```bash
npm test
```

## ID Matching

The `app_user_id` you pass to `Purchases.logIn()` must match what you query with `hasEntitlement()`. Use a consistent identifier like your Convex user ID. The `entitlementId` must match exactly what you configured in the RevenueCat dashboard.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

Apache-2.0
