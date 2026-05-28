# Example app

A runnable Convex backend and React UI that drives the `convex-revenuecat`
component end to end: real RevenueCat Web SDK purchases through the Test Store,
plus a simulator for every webhook the component handles, rendered live.

## What it shows

Two paths into the component, side by side.

Real purchases run through the RevenueCat Web SDK and Test Store. The Buy
buttons call `Purchases.purchase()`, RevenueCat records the sandbox purchase and
sends a real webhook to your `convex.site` endpoint. These are the only actions
that reach RevenueCat, so they're the only ones on the RC webhook dashboard.

Simulated webhooks cover everything else. The Simulate buttons post a
RevenueCat-shaped payload straight to the component's `process` mutation,
bypassing RevenueCat and the HTTP and auth layer. They drive the handler, dedup,
and state logic, but never reach RevenueCat and never show on the dashboard.

Live reactive panels for entitlement, subscription, grace, customer,
virtual-currency, invoice, and recent-webhook state update on every action.

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
npm run dev
npm run example
npm run test
```

Open the Vite URL, buy an offering or fire a simulated webhook, and watch the
panels update live.

## Real vs simulated

RevenueCat only emits events when something real happens, and the web SDK can
trigger only a couple of them. From this client-only demo:

- Real on a buy: `INITIAL_PURCHASE` (Monthly and Yearly) and
  `NON_RENEWING_PURCHASE` (Lifetime). The real SDK runs, so RevenueCat sends the
  webhook and it shows on the RC dashboard.
- Real on RevenueCat's clock: the Test Store auto-renews and expires test
  subscriptions on a compressed schedule, so `RENEWAL` and `EXPIRATION` land on
  their own a few minutes after a buy. Watch the recent-events panel.
- Simulated, because the client can't trigger them: `@revenuecat/purchases-js`
  has no product-change method (`PRODUCT_CHANGE`), virtual currency is read-only
  (`VIRTUAL_CURRENCY_TRANSACTION`), and `changeUser` switches identity without
  re-attributing a receipt, so it fires no `TRANSFER`. Everything else
  (`BILLING_ISSUE`, `SUBSCRIPTION_PAUSED`, `CANCELLATION`, `UNCANCELLATION`,
  `SUBSCRIPTION_EXTENDED`, `INVOICE_ISSUANCE`, refunds,
  `TEMPORARY_ENTITLEMENT_GRANT`, `EXPERIMENT_ENROLLMENT`, `PURCHASE_REDEEMED`,
  `TEST`, and the legacy pair) needs a real store condition, a dashboard action,
  or a server call with a secret key, none of which a client-only showcase can
  force.

Simulated payloads are RevenueCat-shaped, carrying the same fields a real
webhook does. They're tagged `environment: "PRODUCTION"` while real Test Store
events are `SANDBOX`, so you can tell them apart in the `webhookEvents` audit
table. Handler correctness for every event is covered by the component's own
suite (`src/component/*.test.ts`). The simulator just shows the flows live.

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
every user-scoped query. See [`docs/reference.md`](../docs/reference.md) for the
full API table.

Lifecycle hooks (`onEntitlementActivated`, `onEntitlementDeactivated`,
`onCustomerDeleted`) live in [`docs/hooks.md`](../docs/hooks.md); the
`deleteCustomer` GDPR purge is in [`docs/security.md`](../docs/security.md).
Security and correctness fixes are logged in the [CHANGELOG](../CHANGELOG.md).
