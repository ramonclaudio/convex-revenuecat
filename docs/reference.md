# API reference

[← Back to README](../README.md)

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

## Helpers

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
state with live adjustments. See
[Derived `willRenew`](webhooks.md#derived-willrenew).

`decodeSubscriberAttributes(attrs)` rewrites `__dollar__`-encoded keys back to
RC-native `$`-prefixed names (`$email`, `$phoneNumber`, etc.). See
[Decoding attribute keys](security.md#decoding-attribute-keys).

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

## Limitations

- No automatic backfill. Existing subscribers before webhook setup won't appear
  until they trigger a new event or you call `syncSubscriber` for each user.
- Raw payloads stored for 30 days. PII keys redacted by default (see
  [Security](security.md#audit-log-redaction)).
- Rate limited at 100 req/min per app. Dedup runs BEFORE the rate-limit check so
  webhook replays (same `event.id`) don't consume the rate budget.
- Transfer and alias operations cap at 500 source records per user to stay under
  Convex's per-transaction write budget. A pathological account (more than 500
  entitlements or subscriptions) throws `TRANSFER_SAFETY_CAP_EXCEEDED` instead
  of silently corrupting state. `deleteCustomer` (GDPR purge) has no such
  ceiling: it drains in bounded batches across transactions, so call it from an
  action.
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
default): `npm test`.

## ID matching

The `app_user_id` you pass to `Purchases.logIn()` must match what you query with
`hasEntitlement()`. Use a consistent identifier like your Convex user ID. The
`entitlementId` must match exactly what you configured in the RevenueCat
dashboard.
