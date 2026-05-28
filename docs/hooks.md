# Lifecycle hooks

[← Back to README](../README.md)

Register mutations or actions that fire when an entitlement transitions or a
customer is deleted. Every hook is optional. Scheduling happens inside the
component mutation that made the change, so hooks are atomic with state writes:
a rolled-back mutation never fires its hooks, and retries of the same webhook
(same `event.id`) don't double-fire.

```typescript
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
  handler: async (ctx, { appUserId, entitlementId, sourceEventType }) => {},
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
  handler: async (ctx, { appUserId, entitlementId, sourceEventType }) => {},
});

export const onDeleted = internalMutation({
  args: { appUserId: v.string() },
  handler: async (ctx, { appUserId }) => {},
});
```

<!-- prettier-ignore -->
> [!IMPORTANT]
> Make hooks idempotent. They run after the mutation commits, scheduled
> mutations retry exactly-once and actions at-most-once, and the same hook fires
> again on every later transition.

## Firing rules

- `onEntitlementActivated` fires when an entitlement moves from not-active to
  active for an `appUserId`. Triggers include `INITIAL_PURCHASE`, `RENEWAL`
  restoring after revoke, `REFUND_REVERSED`, `TRANSFER` onto a user,
  `SUBSCRIBER_ALIAS`, and `syncSubscriber` catching a change the webhook missed.
- `onEntitlementDeactivated` fires when an active entitlement transitions to
  not-active. Covers `EXPIRATION`, refund `CANCELLATION`
  (`cancel_reason: "CUSTOMER_SUPPORT"` or `price < 0`), `TRANSFER` off a user,
  and sync reconciliation. It does not fire when one of several products
  granting the entitlement expires or is refunded while another still grants it,
  since the entitlement stays active.
- `onCustomerDeleted` fires after `deleteCustomer` purges the component-local
  rows for an `appUserId`.

Hook arguments include `sourceEventType` (the RC webhook `event.type` that
caused the transition, or `"SYNC"` when detected by `syncSubscriber`) plus the
entitlement's `productId`, `purchasedAtMs`, `expiresAtMs`, `store`,
`ownershipType`, and `isSandbox`. `onEntitlementDeactivated` reports the
entitlement's state **before** deactivation so consumers can log, attribute, or
notify with the lost product.

## Per-event semantics

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
