# Example app

A runnable Convex backend and React UI that drives the `convex-revenuecat`
component end to end: real RevenueCat Web SDK purchases through the Test Store,
plus a simulator for every webhook the component handles, rendered live.

## What it shows

- Real purchases of every offering (Monthly, Yearly, Lifetime) through the
  RevenueCat Web SDK and Test Store. Each fires a real webhook at your
  deployment over the HTTP path.
- A simulator that fires every event the component handles (renewal, product
  change, billing issue, expiration, refund, transfer, redeem, virtual currency,
  invoice, experiment, and the rest), for the events RevenueCat won't emit on
  demand.
- Live reactive panels for entitlement, subscription, grace, customer,
  virtual-currency, invoice, and recent-webhook state, plus a reset to start
  from a clean slate.

## Structure

```
example/
├── index.html
├── vite.config.ts
├── tsconfig.app.json
├── src/
│   ├── main.tsx          # ConvexProvider + RevenueCat Web SDK config
│   └── App.tsx           # buy buttons, webhook simulator, live state panels
└── convex/
    ├── convex.config.ts  # registers the component
    ├── schema.ts         # empty app schema, state lives in the component
    ├── http.ts           # mounts the webhook handler via registerRoutes
    ├── subscriptions.ts  # identity-aware queries (auth via ctx.auth)
    ├── demo.ts           # demo-only reads + reset, keyed by explicit appUserId
    ├── simulate.ts       # demo-only: fires synthetic webhooks at the component
    ├── http.test.ts      # end-to-end HTTP tests
    ├── setup.test.ts     # convex-test harness + component registration
    └── example.test.ts   # integration tests using withIdentity
```

`subscriptions.ts` is the pattern to copy into your own app: it spreads
`revenuecat.api()` so every user-scoped query derives `appUserId` from
`ctx.auth.getUserIdentity().subject` server-side. `demo.ts` and `simulate.ts`
take an explicit `appUserId` so the showcase can read and drive any user without
auth. That's an IDOR, never ship it; they exist only to power this demo.

## Setup

1. Set the webhook secret on your deployment (32+ chars):
   ```bash
   openssl rand -base64 32
   npx convex env set REVENUECAT_WEBHOOK_AUTH "your-generated-secret"
   ```
2. Point the RevenueCat dashboard webhook (Integrations → Webhooks) at
   `https://<your-deployment>.convex.site/webhooks/revenuecat`, with the
   Authorization header set to `Bearer <your-secret>`.
3. For the React UI, copy `.env.example` to `.env.local` and fill in your own
   values:
   ```
   VITE_CONVEX_URL=https://<your-deployment>.convex.cloud
   VITE_REVENUECAT_API_KEY=<your-revenuecat-web-billing-public-key>
   ```

## Running

From the repo root, run the backend and the UI together:

```bash
npm run dev        # Convex dev server (functions + deployment)
npm run example    # Vite dev server for the React UI
npm run test       # all tests
```

Open the Vite URL, buy an offering or fire a simulated webhook, and watch the
panels update live.

## Supported webhook events

18 canonical RevenueCat event types plus 2 legacy (`REFUND`, `SUBSCRIBER_ALIAS`)
are handled:

| Event Type                     | Description                                                                                                               |
| :----------------------------- | :------------------------------------------------------------------------------------------------------------------------ |
| `INITIAL_PURCHASE`             | New subscription purchased                                                                                                |
| `RENEWAL`                      | Subscription renewed                                                                                                      |
| `CANCELLATION`                 | Kept until `EXPIRATION`, except refunds (`cancel_reason: "CUSTOMER_SUPPORT"` OR `price < 0`) which revoke immediately     |
| `UNCANCELLATION`               | Cancelled subscription re-enabled                                                                                         |
| `EXPIRATION`                   | Subscription expired                                                                                                      |
| `BILLING_ISSUE`                | Payment failed, grace folded into `expiresAtMs`                                                                           |
| `SUBSCRIPTION_PAUSED`          | Paused (Android), does not revoke                                                                                         |
| `SUBSCRIPTION_EXTENDED`        | Subscription extended                                                                                                     |
| `PRODUCT_CHANGE`               | Subscriber changed product                                                                                                |
| `NON_RENEWING_PURCHASE`        | One-time purchase (stored with `kind: "consumable"`)                                                                      |
| `TRANSFER`                     | Entitlements moved between users                                                                                          |
| `PURCHASE_REDEEMED`            | Web Billing code redemption; grants `redeemed_by`, `alias` merges the original purchaser, `transfer` defers to `TRANSFER` |
| `TEMPORARY_ENTITLEMENT_GRANT`  | Temp access during store outage                                                                                           |
| `REFUND_REVERSED`              | Refund reversed, entitlements restored                                                                                    |
| `INVOICE_ISSUANCE`             | Invoice issued (Web Billing)                                                                                              |
| `VIRTUAL_CURRENCY_TRANSACTION` | Virtual currency adjustment                                                                                               |
| `EXPERIMENT_ENROLLMENT`        | User enrolled in A/B experiment                                                                                           |
| `TEST`                         | Test event from dashboard                                                                                                 |
| `REFUND` _(legacy)_            | As of 2026 refunds arrive as `CANCELLATION`. Handler retained for older projects                                          |
| `SUBSCRIBER_ALIAS` _(legacy)_  | Deprecated. New projects receive `TRANSFER`                                                                               |

## Public APIs

The `RevenueCat` client class exposes query and mutation methods plus `api()`
and `registerRoutes()` helpers. `api()` returns identity-aware handlers for
every user-scoped query. See the main [README](../README.md#api) for the full
reference.

Lifecycle hooks (`onEntitlementActivated`, `onEntitlementDeactivated`,
`onCustomerDeleted`) and the `deleteCustomer` GDPR purge are documented in the
main README's [Lifecycle hooks](../README.md#lifecycle-hooks) section. Security
and correctness fixes are documented in the [CHANGELOG](../CHANGELOG.md).
