# convex-revenuecat

[![npm](https://img.shields.io/npm/v/convex-revenuecat)](https://www.npmjs.com/package/convex-revenuecat)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)

I use RevenueCat for in-app purchases and Convex for everything else. Needed a
way to check entitlements server-side without hitting RevenueCat's API on every
request. So I built a Convex component that receives RevenueCat webhooks and
keeps subscription state in your database. Query it like any other Convex table,
get real-time reactivity for free.

Handles all webhook event types RevenueCat emits, deduplicates by event ID, and
gets the edge cases right: cancellation keeps access until expiration, pause
doesn't revoke, grace periods stay active, and refunds (CANCELLATION with
`cancel_reason: "CUSTOMER_SUPPORT"`) revoke immediately.

This is not a replacement for the
[RevenueCat SDK](https://www.revenuecat.com/docs/getting-started/installation).
Use their SDK client-side for purchases. This handles the server-side state.

There's a runnable demo in [`example/`](example/): real Test Store purchases
through the RevenueCat Web SDK plus a simulator for every webhook, rendered live
with `npm run example`.

## Install

```bash
npm install convex-revenuecat convex
# or
pnpm add convex-revenuecat convex
# or
bun add convex-revenuecat convex
```

`convex` is a peer dependency. Install it alongside the package. Requires Convex
`>=1.35.1`.

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

revenuecat.registerRoutes(http);

export default http;
```

`registerRoutes(http)` defaults to `POST /webhooks/revenuecat`. Pass
`{ path: "/custom/path" }` to mount elsewhere. The longer
`http.route({ path, method: "POST", handler: revenuecat.httpHandler() })` form
still works.

### 3. Set the env variable

```bash
openssl rand -base64 32
npx convex env set REVENUECAT_WEBHOOK_AUTH "your-generated-secret"
```

A secret that's present but shorter than 32 characters (after stripping any
`Bearer ` prefix and whitespace) throws at construction and fails the deploy. A
missing secret doesn't fail the deploy. The handler rejects every webhook with a
500 until you set it. RevenueCat doesn't sign payloads, so the shared secret is
the entire security boundary. An unauthenticated request is never processed.

### 4. Configure RevenueCat

In the [RevenueCat Dashboard](https://app.revenuecat.com), go to Project
Settings > Integrations > Webhooks > + New:

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

### Authorize every query

Never accept `appUserId` as a function argument. Derive it from
`ctx.auth.getUserIdentity()` server-side. Accepting it from the client is an
IDOR: any caller can read any other user's subscription state by passing their
ID. Convex's own AI guidelines spell this out: "NEVER accept a `userId` or any
user identifier as a function argument for authorization purposes."

The snippets below assume `identity.subject` is the same string the mobile app
passes to `Purchases.configure(...)` or `Purchases.logIn(...)`. If your auth
provider's `subject` and your RC `appUserId` differ, look up the mapping from a
`users` table keyed by `identity.tokenIdentifier` instead.

#### Use `revenuecat.api()` to skip the boilerplate

The `api()` factory returns identity-aware query handlers you can spread into
your `convex/` file. Each handler resolves the caller's `appUserId` server-side,
so the IDOR class is closed by construction:

```typescript
// convex/revenuecat.ts
import { RevenueCat } from "convex-revenuecat";
import { components } from "./_generated/api";

export const revenuecat = new RevenueCat(components.revenuecat, {
  REVENUECAT_WEBHOOK_AUTH: process.env.REVENUECAT_WEBHOOK_AUTH,
});

export const {
  // entitlements
  getActiveEntitlements,
  getAllEntitlements,
  getEntitlement,
  hasEntitlement,
  hasAnyEntitlement,
  getRenewsAtMs,
  getExpiresAtMs,
  // subscriptions
  getActiveSubscriptions,
  getAllSubscriptions,
  getConsumables,
  getSubscriptionsInGracePeriod,
  getLatestSubscription,
  isSubscriber,
  isInTrial,
  wasInTrialEver,
  // customer + ancillary
  getCustomer,
  getExperiment,
  getExperiments,
  getInvoices,
  getVirtualCurrencyBalance,
  getVirtualCurrencyBalances,
  getVirtualCurrencyTransactions,
} = revenuecat.api();
```

Then from React: `useQuery(api.revenuecat.isSubscriber, {})`. The factory covers
every user-scoped query the client exposes. Cross-user lookups
(`isInGracePeriod` by transaction id, `getTransfer`/`getInvoice` by id) stay off
`api()` because they belong in role-gated `internalQuery`s, not auth-anywhere
endpoints. Override the resolver with the `getAppUserId` option when your auth
identity and RevenueCat app-user-id are different strings:

```typescript
new RevenueCat(components.revenuecat, {
  REVENUECAT_WEBHOOK_AUTH: process.env.REVENUECAT_WEBHOOK_AUTH,
  getAppUserId: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");
    const user = await ctx.db
      .query("users")
      .withIndex("byTokenIdentifier", (q) =>
        q.eq("tokenIdentifier", identity.tokenIdentifier),
      )
      .unique();
    if (!user) throw new Error("User not found");
    return user.appUserId;
  },
});
```

If you want tier-specific queries (e.g., `checkPremium`), write them on top of
the helpers below. `revenuecat.api()` is the safe default, not the only path.

### Check entitlements

```typescript
import { query } from "./_generated/server";
import { revenuecat } from "./revenuecat";

export const checkPremium = query({
  args: {},
  returns: v.boolean(),
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");
    return await revenuecat.hasEntitlement(ctx, {
      appUserId: identity.subject,
      entitlementId: "premium",
    });
  },
});
```

### Sync from REST API

Webhooks can be delayed or dropped. `syncSubscriber` pulls a subscriber's
current state from RevenueCat's API and reconciles it with the database. All
writes are idempotent, no duplicates.

```typescript
import { action } from "./_generated/server";
import { revenuecat } from "./revenuecat";

export const syncCurrentUser = action({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");
    const appUserId = identity.subject;
    const res = await fetch(
      `https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(appUserId)}`,
      {
        headers: { Authorization: `Bearer ${process.env.REVENUECAT_API_KEY}` },
      },
    );
    if (!res.ok) throw new Error(`RevenueCat API: ${res.status}`);
    const data = await res.json();
    return await revenuecat.syncSubscriber(ctx, {
      appUserId,
      subscriber: data.subscriber,
    });
  },
});
```

Call on app foreground, after purchases, or on a schedule.

> [!WARNING] This requires a **secret** API key, not the public SDK key you pass
> to `Purchases.configure`. Set it as `REVENUECAT_API_KEY` in your Convex
> environment. Using the public key will fail at runtime or grant the wrong
> permissions.

## API

All query methods return empty arrays or `null` for missing users (never throw).
Lifetime purchases without `expirationAtMs` are always considered active.

| Method                                                              | Returns                             |
| :------------------------------------------------------------------ | :---------------------------------- |
| `hasEntitlement(ctx, { appUserId, entitlementId })`                 | `boolean`                           |
| `getEntitlement(ctx, { appUserId, entitlementId })`                 | `Entitlement \| null`               |
| `getActiveEntitlements(ctx, { appUserId })`                         | `Entitlement[]`                     |
| `getAllEntitlements(ctx, { appUserId })`                            | `Entitlement[]`                     |
| `hasAnyEntitlement(ctx, { appUserId })`                             | `boolean`                           |
| `getActiveSubscriptions(ctx, { appUserId })`                        | `Subscription[]`                    |
| `getConsumables(ctx, { appUserId })`                                | `Subscription[]`                    |
| `getAllSubscriptions(ctx, { appUserId })`                           | `Subscription[]`                    |
| `getLatestSubscription(ctx, { appUserId })`                         | `Subscription \| null`              |
| `isSubscriber(ctx, { appUserId })`                                  | `boolean`                           |
| `isInTrial(ctx, { appUserId })`                                     | `boolean`                           |
| `wasInTrialEver(ctx, { appUserId })`                                | `boolean`                           |
| `getRenewsAtMs(ctx, { appUserId, entitlementId })`                  | `number \| null`                    |
| `getExpiresAtMs(ctx, { appUserId, entitlementId })`                 | `number \| null`                    |
| `isInGracePeriod(ctx, { originalTransactionId })`                   | `GracePeriodStatus`                 |
| `getSubscriptionsInGracePeriod(ctx, { appUserId })`                 | `Subscription[]`                    |
| `getCustomer(ctx, { appUserId })`                                   | `Customer \| null`                  |
| `deleteCustomer(ctx, { appUserId })`                                | `DeleteCustomerResult`              |
| `getExperiment(ctx, { appUserId, experimentId })`                   | `Experiment \| null`                |
| `getExperiments(ctx, { appUserId })`                                | `Experiment[]`                      |
| `getTransfer(ctx, { eventId })`                                     | `Transfer \| null`                  |
| `getTransfers(ctx, { limit? })`                                     | `Transfer[]`                        |
| `getInvoice(ctx, { invoiceId })`                                    | `Invoice \| null`                   |
| `getInvoices(ctx, { appUserId })`                                   | `Invoice[]`                         |
| `getVirtualCurrencyBalance(ctx, { appUserId, currencyCode })`       | `VirtualCurrencyBalance \| null`    |
| `getVirtualCurrencyBalances(ctx, { appUserId })`                    | `VirtualCurrencyBalance[]`          |
| `getVirtualCurrencyTransactions(ctx, { appUserId, currencyCode? })` | `VirtualCurrencyTransaction[]`      |
| `syncSubscriber(ctx, { appUserId, subscriber })`                    | `SyncResult`                        |
| `api()`                                                             | typed map of identity-aware queries |
| `registerRoutes(http, { path? })`                                   | mounts the webhook handler          |

### Helpers

Standalone functions exported from `convex-revenuecat` for use on the client or
in any query:

| Helper                              | Returns                          |
| :---------------------------------- | :------------------------------- |
| `willRenew(sub)`                    | `boolean`                        |
| `decodeSubscriberAttributes(attrs)` | `Record<string, T> \| undefined` |

`willRenew(sub)` re-derives the iOS `EntitlementInfo.willRenew` / Android
`EntitlementInfoHelper.getWillRenew` signal from a `Subscription` doc (lifetime,
`PREPAID`, `PROMOTIONAL`, `unsubscribeDetectedAt`, `billingIssueDetectedAt`).
Matches the value already stored in `autoRenewStatus`. Useful when mixing stored
state with live adjustments.

`decodeSubscriberAttributes(attrs)` rewrites `__dollar__`-encoded keys back to
RC-native `$`-prefixed names (`$email`, `$phoneNumber`, etc.). See
[Decoding attribute keys](#decoding-attribute-keys).

## Webhook Events

RevenueCat emits 18 canonical event types. The component handles all of them
plus two legacy events (`REFUND`, `SUBSCRIBER_ALIAS`) that older projects still
receive:

| Event                          | What happens                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| :----------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `INITIAL_PURCHASE`             | Creates subscription, grants entitlements                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `RENEWAL`                      | Extends expiration, clears stale billing/cancel state                                                                                                                                                                                                                                                                                                                                                                                                        |
| `CANCELLATION`                 | Keeps access until expiration. Refunds are the exception: revokes immediately when `cancel_reason === "CUSTOMER_SUPPORT"` OR `price < 0` (covers Google self-serve refunds and dashboard refunds where `cancel_reason` stays `DEVELOPER_INITIATED`)                                                                                                                                                                                                          |
| `EXPIRATION`                   | Revokes entitlements                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `BILLING_ISSUE`                | Extends entitlement `expiresAtMs` to the grace period end so access continues during retry, and sets `autoRenewStatus: false` until `RENEWAL` resolves. If the issue resolves, `RENEWAL` extends further. If not, `EXPIRATION` fires at grace end and revokes. Even if `EXPIRATION` is dropped, access stops at grace end as a hard ceiling                                                                                                                  |
| `SUBSCRIPTION_PAUSED`          | Does not revoke                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `SUBSCRIPTION_EXTENDED`        | Extends expiration                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `TRANSFER`                     | Moves entitlements and subscriptions between users. When the source is a `$RCAnonymousID:` ID with no active data remaining, the source customer row and its audit trail are dropped, matching the "anonymous ID is dead after merge" semantic that iOS `DeviceCache.clearCaches` and Android `deviceCache.clearCachesForAppUserID` apply client-side                                                                                                        |
| `UNCANCELLATION`               | Clears cancellation status                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `PRODUCT_CHANGE`               | Updates product on subscription                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `NON_RENEWING_PURCHASE`        | Grants entitlements for one-time purchase. Stored with `kind: "consumable"` so `getActiveSubscriptions` filters them out and `getConsumables` returns them                                                                                                                                                                                                                                                                                                   |
| `TEMPORARY_ENTITLEMENT_GRANT`  | Grants temp access during a store outage (RC caps it at 24h)                                                                                                                                                                                                                                                                                                                                                                                                 |
| `REFUND_REVERSED`              | Restores entitlements                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `TEST`                         | Logged only                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `INVOICE_ISSUANCE`             | Invoice created (Web Billing)                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `VIRTUAL_CURRENCY_TRANSACTION` | Currency adjustment                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `EXPERIMENT_ENROLLMENT`        | A/B test enrollment tracked                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `PURCHASE_REDEEMED`            | Web Billing code redemption. Ensures the `redeemed_by` customer exists. An `alias` outcome merges the original purchaser's entitlements onto the redeemer, a `transfer` defers to the companion `TRANSFER`                                                                                                                                                                                                                                                   |
| `REFUND` _(legacy)_            | Revokes entitlements. As of 2026 RC emits refunds as `CANCELLATION` with `cancel_reason: "CUSTOMER_SUPPORT"`. Handler retained for legacy projects                                                                                                                                                                                                                                                                                                           |
| `SUBSCRIBER_ALIAS` _(legacy)_  | Migrates data from anonymous to real user ID when `logIn()` is called on a previously-anonymous user. Drops the anonymous source customer row after merge. [Deprecated](https://community.revenuecat.com/sdks-51/replacement-for-subscriber-alias-event-in-webhook-1291). New projects get `TRANSFER` instead (note: `TRANSFER` also fires when `restorePurchases()` attaches an existing receipt to a new user, which is semantically different from alias) |

`CANCELLATION` does NOT revoke entitlements for normal unsubscribes. Users keep
access until `EXPIRATION`. Refunds are the exception: a `CANCELLATION` where
`cancel_reason === "CUSTOMER_SUPPORT"` OR `price < 0` revokes entitlements
immediately. `price < 0` catches Google Play self-serve refunds and
dashboard-issued refunds that leave `cancel_reason` as `DEVELOPER_INITIATED`.
Gating on `cancel_reason` alone leaks access in those cases.

A refund doesn't necessarily deactivate auto-renewal: if the subscription
auto-renews to a new period, a subsequent `RENEWAL` restores access. For extra
safety on cancellation events, callers can optionally call `syncSubscriber` to
cross-check against `GET /v1/subscribers/{app_user_id}`.

### Access-check semantics

`hasEntitlement` mirrors the iOS SDK's `EntitlementInfo.isActive`: the
entitlement's `isActive` flag and `expiresAtMs > now` (with lifetime
entitlements as the no-expiry case). Grace period is encoded into `expiresAtMs`
by the `BILLING_ISSUE` handler and `syncSubscriber`, not signaled via a separate
flag. This avoids the "indefinite access if EXPIRATION drops" bug where a
`billingIssueDetectedAt` short-circuit would keep entitlements active forever
after a failed grace period without retry.

### Derived `willRenew`

`Subscription.autoRenewStatus` is the iOS `EntitlementInfo.willRenew` / Android
`EntitlementInfoHelper.getWillRenew` signal, **not** the raw user-preference
toggle. It's `false` whenever any of these hold: lifetime entitlement (no
`expirationAtMs`), `periodType === "PREPAID"`, `store === "PROMOTIONAL"`,
`unsubscribeDetectedAt` set, or `billingIssueDetectedAt` set. Webhook and REST
sync paths both compute it from the same five-signal check so stored values
converge.

Consumers reading `Subscription` docs can re-derive on the client with the
`willRenew` helper:

```typescript
import { willRenew } from "convex-revenuecat";

const active = subs.filter(willRenew);
```

### Customer record

`getCustomer` returns `countryCode` (ISO 3166-1 alpha-2, mirrored from the
latest event that carried one) and `managementUrl` (RC REST
`subscriber.management_url`, the deep link to the native subscription manager:
App Store on iOS, Play Store on Android, Stripe portal on web). `managementUrl`
is populated only by `syncSubscriber`. Webhooks don't carry it. Both are
`undefined` until the first event/sync that supplies them.

### Family sharing

`entitlements.ownershipType` is populated from the webhook `ownership_type`
field (`PURCHASED`, `FAMILY_SHARED`, or `UNKNOWN`) on every grant/extend, and
from REST sync. Consumers that want to exclude family-shared access for
single-seat products can filter:

```typescript
const active = await revenuecat.getActiveEntitlements(ctx, { appUserId });
const paidAccess = active.filter((e) => e.ownershipType !== "FAMILY_SHARED");
```

## Lifecycle hooks

Register mutations or actions that fire when an entitlement transitions or a
customer is deleted. Every hook is optional. Scheduling happens inside the
component mutation that made the change, so hooks are atomic with state writes:
a rolled-back mutation never fires its hooks, and retries of the same webhook
(same `event.id`) don't double-fire.

```typescript
// convex/revenuecat.ts
import { RevenueCat } from "convex-revenuecat";
import { components, internal } from "./_generated/api";

export const revenuecat = new RevenueCat(components.revenuecat, {
  REVENUECAT_WEBHOOK_AUTH: process.env.REVENUECAT_WEBHOOK_AUTH,
  hooks: {
    onEntitlementActivated: internal.subscriptions.onGranted,
    onEntitlementDeactivated: internal.subscriptions.onRevoked,
    onCustomerDeleted: internal.subscriptions.onDeleted,
  },
});
```

```typescript
// convex/subscriptions.ts
import { v } from "convex/values";
import { internalMutation } from "./_generated/server";

export const onGranted = internalMutation({
  args: {
    appUserId: v.string(),
    entitlementId: v.string(),
    productId: v.optional(v.string()),
    purchasedAtMs: v.optional(v.number()),
    expiresAtMs: v.optional(v.number()),
    store: v.optional(v.string()),
    ownershipType: v.optional(v.string()),
    isSandbox: v.boolean(),
    sourceEventType: v.string(),
  },
  handler: async (ctx, { appUserId, entitlementId, sourceEventType }) => {
    // Send welcome email, provision external service, etc.
    // Branch on sourceEventType to handle INITIAL_PURCHASE vs RENEWAL vs
    // REFUND_REVERSED vs TRANSFER vs SUBSCRIBER_ALIAS vs SYNC.
  },
});

export const onRevoked = internalMutation({
  args: {
    appUserId: v.string(),
    entitlementId: v.string(),
    productId: v.optional(v.string()),
    purchasedAtMs: v.optional(v.number()),
    expiresAtMs: v.optional(v.number()),
    store: v.optional(v.string()),
    ownershipType: v.optional(v.string()),
    isSandbox: v.boolean(),
    sourceEventType: v.string(),
  },
  handler: async (ctx, { appUserId, entitlementId, sourceEventType }) => {
    // Tear down external resources, downgrade UI, etc.
    // sourceEventType distinguishes EXPIRATION vs CANCELLATION (refund) vs
    // TRANSFER vs SYNC.
  },
});

export const onDeleted = internalMutation({
  args: { appUserId: v.string() },
  handler: async (ctx, { appUserId }) => {
    // Purge your own app-side data for this user.
  },
});
```

Firing rules:

- `onEntitlementActivated` fires when an entitlement moves from not-active to
  active for an `appUserId`. Triggers include `INITIAL_PURCHASE`, `RENEWAL`
  restoring after revoke, `REFUND_REVERSED`, `TRANSFER` onto a user,
  `SUBSCRIBER_ALIAS`, and `syncSubscriber` catching a change the webhook missed.
- `onEntitlementDeactivated` fires when an active entitlement transitions to
  not-active. Covers `EXPIRATION`, refund `CANCELLATION`
  (`cancel_reason: "CUSTOMER_SUPPORT"` or `price < 0`), `TRANSFER` off a user,
  and sync reconciliation.
- `onCustomerDeleted` fires after `deleteCustomer` purges the component-local
  rows for an `appUserId`.

Hook arguments include `sourceEventType` (the RC webhook `event.type` that
caused the transition, or `"SYNC"` when detected by `syncSubscriber`) plus the
entitlement's `productId`, `purchasedAtMs`, `expiresAtMs`, `store`,
`ownershipType`, and `isSandbox`. `onEntitlementDeactivated` reports the
entitlement's state **before** deactivation so consumers can log, attribute, or
notify with the lost product.

Per-event semantics:

- Multi-entitlement events fire one hook invocation per transitioning
  entitlement.
- Idempotent events fire at most once per transition. A retry with the same
  `event.id` dedups before the handler runs.
- `TRANSFER` fires `onEntitlementDeactivated` for the source user and
  `onEntitlementActivated` for the destination.
- Hooks run via Convex's scheduler **after** the enclosing mutation commits. A
  rolled-back mutation never schedules its hooks (scheduler writes are part of
  the transaction). A hook throwing does NOT retry the webhook. Scheduled
  mutations retry exactly-once per Convex scheduler policy. Scheduled actions
  retry at-most-once. Make hooks idempotent.
- Snapshots that power transition detection only run when at least one hook is
  configured, so consumers without hooks pay zero overhead.

### Cross-platform coverage

Handlers accept webhook payloads from all RevenueCat stores: Apple App Store,
Mac App Store, Google Play Store, Amazon Appstore, Stripe, Paddle, Roku, Samsung
Galaxy Store, RevenueCat Web Billing, the External Purchases API, and
promotional/test grants. `store` values unknown to a given schema version
normalize to `UNKNOWN_STORE` rather than rejecting the event. Payload fields not
present in the component's validator are accepted and stored in
`webhookEvents.payload` (RC reserves the right to add fields without
versioning).

## Delivery and retries

RevenueCat delivers webhooks at-least-once with rare duplicates. The component
dedupes by `event.id` via the `webhookEvents` table.

RC's retry policy: 5 retries at 5, 10, 20, 40, and 80 minutes after first
failure. Request timeout is 60s. Only HTTP 200 counts as success. Any other code
(including 429 from the built-in rate limiter) triggers retry. After 5 failed
attempts the event is dropped.

## Authentication

> [!IMPORTANT] RevenueCat does not sign webhook payloads. There's no HMAC and no
> `X-RevenueCat-Signature` header. The only auth mechanism is the
> dashboard-configured `Authorization` header shared secret. Rotate it from the
> RC dashboard if you suspect leakage.

## RevenueCat REST API rate limits

If you call `syncSubscriber` or the RC REST API from your actions, RC applies
these limits:

| API                                        | Domain                                  | Limit                                       |
| :----------------------------------------- | :-------------------------------------- | :------------------------------------------ |
| v1 `/v1/subscribers/...`                   | (undocumented)                          | Treat as unpublished. Throttle aggressively |
| v2 Customer Information                    | Customer Information                    | 480 req/min                                 |
| v2 Project Configuration                   | Project Configuration                   | 60 req/min                                  |
| v2 Charts & Metrics                        | Charts & Metrics                        | 5 req/min                                   |
| v2 Virtual Currencies - Create Transaction | Virtual Currencies - Create Transaction | 480 req/min                                 |

Limits apply per API key (app-level keys) or per developer (developer-level
keys). Responses carry `RevenueCat-Rate-Limit-Current-Usage` and
`RevenueCat-Rate-Limit-Current-Limit` headers. 429 on exceed.

## PII and subscriber attributes

Webhooks carry subscriber attributes with RC-reserved `$`-prefixed keys
(`$email`, `$phoneNumber`, `$apnsTokens`, `$fcmTokens`, `$displayName`, `$ip`,
etc.).

### Audit-log redaction

The `webhookEvents` audit table keeps 30 days of payloads for debugging. The
default `redactPayload` strips the reserved PII keys from
`subscriber_attributes` before writing to that table. Override or disable:

```typescript
new RevenueCat(components.revenuecat, {
  REVENUECAT_WEBHOOK_AUTH: process.env.REVENUECAT_WEBHOOK_AUTH,
  redactPayload: (payload) => {
    // Custom redactor. Return whatever should be persisted.
    return payload;
  },
  // Or disable entirely (not recommended):
  // redactPayload: "off",
});
```

### Decoding attribute keys

Customer attributes are stored with `__dollar__`-encoded keys. Convex rejects
`$` at every nesting level, so the component encodes on write. Decode on read:

```typescript
import { decodeSubscriberAttributes } from "convex-revenuecat";

const customer = await revenuecat.getCustomer(ctx, { appUserId });
const attrs = decodeSubscriberAttributes(customer?.attributes);
console.log(attrs?.$email?.value); // "user@example.com"
```

## Limitations

- No automatic backfill. Existing subscribers before webhook setup won't appear
  until they trigger a new event or you call `syncSubscriber` for each user.
- Raw payloads stored for 30 days. PII keys redacted by default (see above).
- Rate limited at 100 req/min per app. Dedup runs BEFORE the rate-limit check so
  webhook replays (same `event.id`) don't consume the rate budget.
- Transfer/alias/purge operations cap at 500 records per user to stay under
  Convex's per-transaction write budget. Pathological accounts (more than 500
  entitlements or subscriptions for a single user) will throw instead of
  silently corrupting state.
- `event.id` is capped at 128 bytes. Webhook bodies are capped at 1MB. Both
  reject at the HTTP boundary before any database touch.
- `event.event_timestamp_ms` is clamped to `now + 5min` on insert so a
  clock-skewed or malicious timestamp can't lock `customers.firstSeenAt` /
  `lastSeenAt` at a far-future value.

## Maintenance

No setup required. The component prunes its own bookkeeping tables on internal
cron jobs:

- rate-limit rows older than the 60s window, hourly
- webhook audit events past the 30-day retention, daily

Both delete in batches and self-reschedule if a backlog exceeds the per-run cap.

## Upgrading from 0.2.1

If your deployment shipped 0.2.1 or earlier, run two one-shot migrations after
upgrading. Both are idempotent and paginated. Loop until `nextCursor` is null.

`transfers.backfillTransferParticipants` populates the new
`transferParticipants` join table for legacy `transfers` rows so GDPR purge
stays index-driven instead of falling back to the bounded scan.

`subscriptions.backfillKind` walks the `webhookEvents` audit log for
`NON_RENEWING_PURCHASE` events and patches matching subscriptions to
`kind: "consumable"`. Without this, pre-0.3.0 consumable rows leak into
`getActiveSubscriptions` (their `kind` is `undefined`, so the filter treats them
as recurring). Bounded by the 30-day audit retention. Older rows can't be
classified this way and stay `kind: undefined`.

```typescript
import { internalAction } from "./_generated/server";
import { components } from "./_generated/api";

export const backfillRevenueCat = internalAction({
  args: {},
  handler: async (ctx) => {
    for (const mutation of [
      components.revenuecat.transfers.backfillTransferParticipants,
      components.revenuecat.subscriptions.backfillKind,
    ] as const) {
      let cursor: string | null = null;
      do {
        const result = await ctx.runMutation(mutation, {
          cursor: cursor ?? undefined,
        });
        cursor = result.nextCursor;
      } while (cursor);
    }
  },
});
```

## GDPR / data deletion

`deleteCustomer(ctx, { appUserId })` purges all component-local rows for a user:
customer, subscriptions, entitlements, experiments, invoices, virtual currency
balances/transactions, webhook events (including the `TRANSFER` audit rows,
which carry no `app_user_id` and are matched through the user's transfer
records), and transfers. Audit rows recorded under a prior alias ID age out via
the 30-day retention. Call from a mutation or action.

To also purge RevenueCat-side, call `DELETE /v1/subscribers/{app_user_id}` from
a Convex action with a secret API key. RC confirms the delete endpoint is
sufficient for GDPR erasure on their side.

```typescript
import { action } from "./_generated/server";
import { revenuecat } from "./revenuecat";

export const forgetMe = action({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");
    const appUserId = identity.subject;
    const local = await revenuecat.deleteCustomer(ctx, { appUserId });
    await fetch(
      `https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(appUserId)}`,
      {
        method: "DELETE",
        headers: { Authorization: `Bearer ${process.env.REVENUECAT_API_KEY}` },
      },
    );
    return local;
  },
});
```

GDPR data deletion requests typically arrive through a support workflow rather
than a self-serve client mutation. If you wire a public action like the one
above, keep it scoped to the authenticated caller's own data. For
admin-initiated purges (a support agent acting on a different `appUserId`), use
a separate `internalAction` gated by an explicit role check, never a public
action that accepts `appUserId` from the client.

## Testing

The `convex-revenuecat/test` export wires the component into a `convex-test`
instance so you can exercise webhooks and entitlement queries in unit tests
without a live deployment:

```typescript
import { convexTest } from "convex-test";
import revenuecatTest from "convex-revenuecat/test";
import schema from "./schema";

export function initConvexTest() {
  const t = convexTest(schema, import.meta.glob("./**/*.*s"));
  revenuecatTest.register(t);
  return t;
}
```

Run your suite with whatever test runner `convex-test` supports (Vitest, by
default):

```bash
npm test
```

## ID Matching

The `app_user_id` you pass to `Purchases.logIn()` must match what you query with
`hasEntitlement()`. Use a consistent identifier like your Convex user ID. The
`entitlementId` must match exactly what you configured in the RevenueCat
dashboard.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Security

Do not report vulnerabilities through public issues. See
[SECURITY.md](SECURITY.md) for the policy, private reporting channels, and
coordinated disclosure timeline.

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for release history.

## License

Apache-2.0
