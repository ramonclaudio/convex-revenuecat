# Security, PII, and GDPR

[← Back to README](../README.md)

For reporting vulnerabilities, see [SECURITY.md](../SECURITY.md).

## Authentication

<!-- prettier-ignore -->
> [!IMPORTANT]
> RevenueCat does not sign webhook payloads. There's no HMAC and no
> `X-RevenueCat-Signature` header. The only auth mechanism is the
> dashboard-configured `Authorization` header shared secret. Rotate it from the
> RC dashboard if you suspect leakage.

The secret is set as `REVENUECAT_WEBHOOK_AUTH` (see the README setup steps). A
secret present but shorter than 32 characters (after stripping any `Bearer `
prefix and whitespace) throws at construction and fails the deploy. A missing
secret doesn't fail the deploy, but the handler rejects every webhook with a 500
until you set it. An unauthenticated request is never processed.

## Authorize every query

Never accept `appUserId` as a function argument. Derive it from
`ctx.auth.getUserIdentity()` server-side. Accepting it from the client is an
IDOR: any caller can read any other user's subscription state by passing their
ID. Convex's own AI guidelines spell this out: "NEVER accept a `userId` or any
user identifier as a function argument for authorization purposes."

`revenuecat.api()` (see the README) closes this by construction: every handler
it returns resolves the caller's `appUserId` server-side. Cross-user lookups
(`isInGracePeriod` by transaction id, `getTransfer` / `getInvoice` by id) stay
off `api()` because they belong in role-gated `internalQuery`s, not
auth-anywhere endpoints.

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
    return payload;
  },
});
```

### Decoding attribute keys

Customer attributes are stored with `__dollar__`-encoded keys. Convex rejects
`$` at every nesting level, so the component encodes on write. Decode on read:

```typescript
import { decodeSubscriberAttributes } from "convex-revenuecat";

const customer = await revenuecat.getCustomer(ctx, { appUserId });
const attrs = decodeSubscriberAttributes(customer?.attributes);
console.log(attrs?.$email?.value);
```

## GDPR / data deletion

`deleteCustomer(ctx, { appUserId })` purges all component-local rows for a user:
customer, subscriptions, entitlements, experiments, invoices, virtual currency
balances/transactions, webhook events (including the `TRANSFER` and
`PURCHASE_REDEEMED` audit rows, which carry no `app_user_id` and are matched
through the user's transfer/redemption records), and transfers. Audit rows
recorded under a prior alias ID age out via the 30-day retention. It purges in
bounded batches across transactions, so **call it from an action** to fully
erase a user with a large ledger (e.g. heavy virtual-currency history).

<!-- prettier-ignore -->
> [!CAUTION]
> `deleteCustomer` is destructive and unauthenticated: it purges whatever
> `appUserId` you hand it. Never expose it in a public mutation that takes
> `appUserId` from the client. Gate it behind your own auth or role check.

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
