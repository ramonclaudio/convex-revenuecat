# convex-revenuecat

[![npm](https://img.shields.io/npm/v/convex-revenuecat)](https://www.npmjs.com/package/convex-revenuecat)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)

A Convex component that mirrors RevenueCat subscription state in your own
database. It ingests every webhook RevenueCat sends and gets the edge cases
right (cancellation keeps access until expiration, grace periods stay active,
refunds revoke immediately, an entitlement stays active while any active product
still grants it), so you check entitlements server-side by querying it like any
other Convex table, with real-time reactivity and no per-request API call. Use
it alongside the
[RevenueCat SDK](https://www.revenuecat.com/docs/getting-started/installation),
which still handles purchases client-side.

## Install

```bash
npm install convex-revenuecat convex
```

`convex` is a peer dependency (`>=1.35.1`). `pnpm` and `bun` work too.

## Setup

**1. Register the component** in `convex/convex.config.ts`.

```typescript
import { defineApp } from "convex/server";
import revenuecat from "convex-revenuecat/convex.config";

const app = defineApp();
app.use(revenuecat);
export default app;
```

**2. Mount the webhook handler** in `convex/http.ts`.

```typescript
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

`registerRoutes(http)` mounts `POST /webhooks/revenuecat`. Pass `{ path }` to
move it.

**3. Set the webhook secret.** RevenueCat doesn't sign payloads, so this shared
secret is the entire security boundary.

```bash
npx convex env set REVENUECAT_WEBHOOK_AUTH "$(openssl rand -base64 32)"
```

A secret under 32 chars fails the deploy. A missing secret rejects every webhook
with a 500 until you set it.

**4. Point RevenueCat at it.** In the [dashboard](https://app.revenuecat.com),
Project Settings → Integrations → Webhooks → New: URL
`https://<your-deployment>.convex.site/webhooks/revenuecat`, Authorization
header set to the secret from step 3. Hit "Send Test Event" and check
`npx convex logs`.

## Usage

Spread `revenuecat.api()` into `convex/revenuecat.ts`. Each handler resolves the
caller's `appUserId` from `ctx.auth.getUserIdentity()` server-side:

<!-- prettier-ignore -->
> [!IMPORTANT]
> Never take `appUserId` from the client. `api()` derives it server-side from
> `ctx.auth.getUserIdentity()`. Accepting a user ID as an argument is an IDOR,
> any caller could read anyone else's subscription state.

```typescript
import { RevenueCat } from "convex-revenuecat";
import { components } from "./_generated/api";

export const revenuecat = new RevenueCat(components.revenuecat, {
  REVENUECAT_WEBHOOK_AUTH: process.env.REVENUECAT_WEBHOOK_AUTH,
});

export const {
  hasEntitlement,
  isSubscriber,
  getActiveSubscriptions,
  getCustomer,
} = revenuecat.api();
```

<details>
<summary>Every query <code>api()</code> exposes</summary>

```typescript
export const {
  getActiveEntitlements,
  getAllEntitlements,
  getEntitlement,
  hasEntitlement,
  hasAnyEntitlement,
  getRenewsAtMs,
  getExpiresAtMs,
  getActiveSubscriptions,
  getAllSubscriptions,
  getConsumables,
  getSubscriptionsInGracePeriod,
  getLatestSubscription,
  isSubscriber,
  isInTrial,
  wasInTrialEver,
  getCustomer,
  getExperiment,
  getExperiments,
  getInvoices,
  getVirtualCurrencyBalance,
  getVirtualCurrencyBalances,
  getVirtualCurrencyTransactions,
} = revenuecat.api();
```

</details>

```typescript
const subscribed = useQuery(api.revenuecat.isSubscriber, {});
```

If your auth `subject` and RevenueCat `appUserId` are different strings, pass
the `getAppUserId` option to map them. Need a custom check like `checkPremium`?
Write it on top of
`revenuecat.hasEntitlement(ctx, { appUserId, entitlementId })`.

Webhooks can lag or drop. `syncSubscriber` reconciles a user against
RevenueCat's REST API, idempotently. See
[Sync from the REST API](docs/webhooks.md#sync-from-the-rest-api).

## API

About 30 query methods plus `syncSubscriber`, `deleteCustomer`, `api()`, and
`registerRoutes`. Every query returns `[]` or `null` for missing users and never
throws. Two standalone helpers, `willRenew(sub)` and
`decodeSubscriberAttributes(attrs)`, are exported for client-side use. Full
signatures in [`docs/reference.md`](docs/reference.md).

## Docs

- [`docs/webhooks.md`](docs/webhooks.md), every event's behavior, access-check
  semantics, derived `willRenew`, cross-platform coverage, and REST sync.
- [`docs/hooks.md`](docs/hooks.md), lifecycle hooks that fire on entitlement
  transitions and customer deletes.
- [`docs/security.md`](docs/security.md), webhook auth, PII redaction, and GDPR
  deletion.
- [`docs/reference.md`](docs/reference.md), the full API table, helpers, rate
  limits, limitations, and upgrade migrations.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Security

RevenueCat doesn't sign webhooks, so the `Authorization` shared secret is the
only boundary. Rotate it from the RC dashboard if it leaks. Don't report
vulnerabilities through public issues, see [SECURITY.md](SECURITY.md).

## Changelog

See [CHANGELOG.md](CHANGELOG.md).

## License

Apache-2.0
