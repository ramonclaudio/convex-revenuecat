# convex-revenuecat

[![npm](https://img.shields.io/npm/v/convex-revenuecat)](https://www.npmjs.com/package/convex-revenuecat)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)

I use RevenueCat for in-app purchases and Convex for everything else. Needed a way to check entitlements server-side without hitting RevenueCat's API on every request. So I built a Convex component that receives RevenueCat webhooks and keeps subscription state in your database. Query it like any other Convex table, get real-time reactivity for free.

Handles all webhook event types RevenueCat emits, deduplicates by event ID, and gets the edge cases right: cancellation keeps access until expiration, pause doesn't revoke, grace periods stay active, and refunds (CANCELLATION with `cancel_reason: "CUSTOMER_SUPPORT"`) revoke immediately.

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
| `deleteCustomer(ctx, { appUserId })` | `DeleteCustomerResult` |
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

RevenueCat emits 17 canonical event types. The component handles all of them plus two legacy events (`REFUND`, `SUBSCRIBER_ALIAS`) that older projects still receive:

| Event | What happens |
|:------|:-------------|
| `INITIAL_PURCHASE` | Creates subscription, grants entitlements |
| `RENEWAL` | Extends expiration, clears stale billing/cancel state |
| `CANCELLATION` | Keeps access until expiration — except refunds, which revoke immediately. A cancellation is treated as a refund when `cancel_reason === "CUSTOMER_SUPPORT"` OR `price < 0` (covers Google self-serve refunds and dashboard refunds where `cancel_reason` stays `DEVELOPER_INITIATED`) |
| `EXPIRATION` | Revokes entitlements |
| `BILLING_ISSUE` | Extends entitlement `expiresAtMs` to the grace period end so access continues during retry. If the issue resolves, `RENEWAL` extends further; if not, `EXPIRATION` fires at grace end and revokes. Even if `EXPIRATION` is dropped, access stops at grace end as a hard ceiling |
| `SUBSCRIPTION_PAUSED` | Does not revoke |
| `SUBSCRIPTION_EXTENDED` | Extends expiration |
| `TRANSFER` | Moves entitlements and subscriptions between users |
| `UNCANCELLATION` | Clears cancellation status |
| `PRODUCT_CHANGE` | Updates product on subscription |
| `NON_RENEWING_PURCHASE` | Grants entitlements for one-time purchase |
| `TEMPORARY_ENTITLEMENT_GRANT` | Temp access during store outage (24h max) |
| `REFUND_REVERSED` | Restores entitlements |
| `TEST` | Logged only |
| `INVOICE_ISSUANCE` | Invoice created (Web Billing) |
| `VIRTUAL_CURRENCY_TRANSACTION` | Currency adjustment |
| `EXPERIMENT_ENROLLMENT` | A/B test enrollment tracked |
| `REFUND` *(legacy)* | Revokes entitlements. As of 2026 RC emits refunds as `CANCELLATION` with `cancel_reason: "CUSTOMER_SUPPORT"` — handler retained for legacy projects |
| `SUBSCRIBER_ALIAS` *(legacy)* | Migrates data from anonymous to real user ID when `logIn()` is called on a previously-anonymous user. [Deprecated](https://community.revenuecat.com/sdks-51/replacement-for-subscriber-alias-event-in-webhook-1291) — new projects get `TRANSFER` instead (note: `TRANSFER` also fires when `restorePurchases()` attaches an existing receipt to a new user, which is semantically different from alias) |

`CANCELLATION` does NOT revoke entitlements for normal unsubscribes — users keep access until `EXPIRATION`. Refunds are the exception: a `CANCELLATION` where `cancel_reason === "CUSTOMER_SUPPORT"` OR `price < 0` revokes entitlements immediately. `price < 0` catches Google Play self-serve refunds and dashboard-issued refunds that leave `cancel_reason` as `DEVELOPER_INITIATED`; gating on `cancel_reason` alone leaks access in those cases.

Per RC docs, CANCELLATION only fires for a refund of the subscription's **latest** period — earlier-period refunds don't trigger the event. A refund also doesn't necessarily deactivate auto-renewal: if the subscription auto-renews to a new period, a subsequent `RENEWAL` restores access. For extra safety on cancellation events, callers can optionally call `syncSubscriber` to cross-check against `GET /v1/subscribers/{app_user_id}`.

### Access-check semantics

`hasEntitlement` mirrors the iOS SDK's `EntitlementInfo.isActive`: pure `expiresAtMs > now` (with lifetime entitlements as the no-expiry case). Grace period is encoded into `expiresAtMs` by the `BILLING_ISSUE` handler and `syncSubscriber`, not signaled via a separate flag. This avoids the "indefinite access if EXPIRATION drops" bug where a `billingIssueDetectedAt` short-circuit would keep entitlements active forever after a failed grace period without retry.

### Family sharing

`entitlements.ownershipType` is populated from the webhook `ownership_type` field (`PURCHASED` or `FAMILY_SHARED`) on every grant/extend, and from REST sync. Consumers that want to exclude family-shared access for single-seat products can filter:

```typescript
const active = await revenuecat.getActiveEntitlements(ctx, { appUserId });
const paidAccess = active.filter((e) => e.ownershipType !== "FAMILY_SHARED");
```

### Cross-platform coverage

Handlers accept webhook payloads from all RevenueCat stores: Apple App Store, Mac App Store, Google Play Store, Amazon Appstore, Stripe, Paddle, Roku, Samsung Galaxy Store, RevenueCat Web Billing, the External Purchases API, and promotional/test grants. `store` values unknown to a given schema version normalize to `UNKNOWN_STORE` rather than rejecting the event. Payload fields not present in the component's validator are accepted and stored in `webhookEvents.payload` (RC reserves the right to add fields without versioning).

## Delivery and retries

RevenueCat delivers webhooks at-least-once with rare duplicates. The component dedupes by `event.id` via the `webhookEvents` table.

RC's retry policy: 5 retries at 5, 10, 20, 40, and 80 minutes after first failure. Request timeout is 60s. Only HTTP 200 counts as success; any other code (including 429 from the built-in rate limiter) triggers retry. After 5 failed attempts the event is dropped.

## Authentication

RevenueCat does not sign webhook payloads (no HMAC, no `X-RevenueCat-Signature` header). The only auth mechanism is the dashboard-configured `Authorization` header shared secret. Rotate it from the RC dashboard if leaked.

## RevenueCat REST API rate limits

If you call `syncSubscriber` or the RC REST API from your actions, RC applies these limits:

| API | Domain | Limit |
|:----|:-------|:------|
| v1 `/v1/subscribers/...` | (undocumented) | Treat as unpublished; throttle aggressively |
| v2 Customer Information | Customer Information | 480 req/min |
| v2 Project Configuration | Project Configuration | 60 req/min |
| v2 Charts & Metrics | Charts & Metrics | 5 req/min |

## Limitations

- No automatic backfill. Existing subscribers before webhook setup won't appear until they trigger a new event or you call `syncSubscriber` for each user.
- Raw payloads stored for debugging. May contain subscriber attributes (`$email`, `$displayName`, etc. when set via the SDK). Auto-deleted after 30 days.
- Rate limited at 100 req/min per app. Built-in, no config needed.
- Transfer/alias/purge operations cap at 500 records per user to stay under Convex's per-transaction write budget. Pathological accounts (more than 500 entitlements or subscriptions for a single user) will throw instead of silently corrupting state.

## GDPR / data deletion

`deleteCustomer(ctx, { appUserId })` purges all component-local rows for a user: customer, subscriptions, entitlements, experiments, invoices, virtual currency balances/transactions, and webhook events. Call from a mutation or action.

To also purge RevenueCat-side, call `DELETE /v1/subscribers/{app_user_id}` from a Convex action with a secret API key. RC confirms the delete endpoint is sufficient for GDPR erasure on their side.

```typescript
import { action } from "./_generated/server";
import { revenuecat } from "./revenuecat";
import { v } from "convex/values";

export const forgetUser = action({
  args: { appUserId: v.string() },
  handler: async (ctx, args) => {
    const local = await revenuecat.deleteCustomer(ctx, { appUserId: args.appUserId });
    await fetch(
      `https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(args.appUserId)}`,
      { method: "DELETE", headers: { Authorization: `Bearer ${process.env.REVENUECAT_API_KEY}` } },
    );
    return local;
  },
});
```

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
