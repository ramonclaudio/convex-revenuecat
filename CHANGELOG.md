# Changelog

## [Unreleased]

## [0.3.1] - 2026-05-27

`0.3.0` shipped `webhooks.recordFailure` as an `internalMutation`, which Convex
omits from the generated component API, so the client's required reference
didn't resolve and consumers couldn't build. This restores the parent-callable
surface and regenerates the component API from real `convex codegen`, and
refreshes the dev toolchain and CI.

### Fixed

- `webhooks.process`, `webhooks.recordFailure`, `subscriptions.backfillKind`,
  and `transfers.backfillTransferParticipants` are public, so
  `components.revenuecat` exposes them and the component builds without a cast.
  Reported in
  [#19](https://github.com/ramonclaudio/convex-revenuecat/issues/19).
- Webhook auth validates at request time instead of throwing at module load; a
  module-load throw failed Convex push analysis on a real deployment.
- `PURCHASE_REDEEMED` grants `redeemed_by` and merges the original purchaser on
  `alias` outcomes; `transfer` outcomes defer to the companion `TRANSFER`.
- Virtual-currency balances clamp at 0 and dedupe adjustments by transaction id.
- `priceUsd` stores RevenueCat's already-USD `price`; a currency gate had been
  dropping it for non-USD events.
- `deleteCustomer` purges `TRANSFER` audit rows, which carry no `app_user_id`.
- Bound the rate-limit window read so a flooded key can't amplify reads.

### Security

- Force `ws@8.20.1` via `overrides` to clear GHSA-58qx-3vcg-4xpx (uninitialized
  memory disclosure) in the `ws@8.18.0` that `convex` pins. Dev-tree only, never
  shipped in the published package. The fix is on convex `main` but unreleased.
  Drop the override once `convex` ships `> 1.39.1` with `ws >= 8.20.1`. See
  [get-convex/convex-js#166](https://github.com/get-convex/convex-js/issues/166).

### Changed

- `subscriptions.list` and `transfers.list` paginate via `convex-helpers`, now a
  runtime dependency.
- Bumped Vite to 8 and `@vitejs/plugin-react` to 6. Refreshed the dev toolchain:
  `convex` 1.39.1, `convex-test` 0.0.53, `eslint` 10.4.0 (+ `@eslint/js`),
  `@vitest/coverage-v8` and `vitest` 4.1.7, `typescript-eslint` 8.60, plus
  `@types/node`, `globals`, `jiti`, `pkg-pr-new`.
- Restored the `tsconfig.json` lib to ES2023 and `types: ["node"]` to match the
  Convex component template.

### Added

- `example/` is a runnable Vite + React app (`npm run example`) with real
  RevenueCat Web SDK purchases through the Test Store and a simulator for every
  webhook. Repo-only, not shipped in the package.
- PR CI workflow runs `format:check`, `test`, `lint`, and `typecheck` on every
  pull request.
- The example frontend is type-checked: `typecheck` now runs
  `tsc -p example/tsconfig.app.json` alongside the component and
  `example/convex`.
- `format` and `format:check` scripts plus `.prettierignore`; the codebase is
  Prettier-clean and `validate` enforces it.
- Resynced the Convex AI files via `npx convex ai-files install`.

## [0.3.0] - 2026-05-09

`httpHandler()` was getting silently mounted unauthenticated when
`REVENUECAT_WEBHOOK_AUTH` was missing. Plus an audit pass on the handlers, GDPR
purge, PII list, and the example that fell out of fixing it.

### Upgrade notes

- Set `REVENUECAT_WEBHOOK_AUTH` before deploying. `httpHandler()` throws at
  module load if it's missing or under 32 chars after stripping `Bearer ` and
  whitespace. `openssl rand -base64 32` produces ~44 chars.
- Audit any queries that take `appUserId` from the client. The package surface
  is unchanged, but the README and `example/convex/subscriptions.ts` previously
  showed an IDOR pattern. Spread `revenuecat.api()` so each handler derives
  `appUserId` from `ctx.auth.getUserIdentity().subject` server-side.
- Run `transfers.backfillTransferParticipants` once if you have pre-0.3.0
  TRANSFER data. The new `transferParticipants` join table makes GDPR purge
  O(per-user). `customers.purge` falls back to the legacy scan for unbackfilled
  rows, so the upgrade is non-blocking.
- Run `subscriptions.backfillKind` once if you have pre-0.3.0
  NON_RENEWING_PURCHASE data. Walks the `webhookEvents` audit log and patches
  matching rows to `kind: "consumable"`. Bounded by the 30-day audit retention.

### Fixed

- `httpHandler()` throws at module load when `REVENUECAT_WEBHOOK_AUTH` is
  missing or under 32 chars after stripping `Bearer ` and whitespace. Matches
  Stripe's `whsec_` minimum and NIST SP 800-63B's 128-bit secure-token bar.
- `upsertSubscription` and `grantEntitlements` preserve prices, ownership, and
  offer codes across partial events. Each field falls back to `existing.field`
  so a webhook missing a key can't erase it.
- README and `example/convex/subscriptions.ts` drop the IDOR pattern. Every
  example query derives `appUserId` from `ctx.auth.getUserIdentity().subject`
  instead of accepting `v.string()` args.
- `DEFAULT_PII_ATTRIBUTE_KEYS` rebuilt line-by-line against
  `ReservedSubscriberAttributes.swift` and `SpecialSubscriberAttributes.kt`.
  Strips `$amazonAdId`, `$attConsentStatus`, `$deviceVersion`, `$apnsTokens`,
  and every attribution-ID key (`$adjustId`, `$appsflyerId`, `$onesignalId`,
  `$mixpanelDistinctId`, `$firebaseAppInstanceId`).
- HTTP boundary rejects 1MB+ bodies, unknown `environment` values, whitespace
  event ids, and 128+ char event ids before any database touch.
- Rate-limit key falls back to `app_user_id` when `app_id` is absent.
  App-id-less events get per-user buckets instead of a shared global one.
- `customers.lastSeenAt` stays monotonic. `event.event_timestamp_ms` is clamped
  to `now + 5min`. `customers.originalAppUserId` falls back through event,
  existing, then `appUserId`.
- TRANSFER dedupes on direct re-invocation. Anonymous-source cleanup also drops
  `transferParticipants`.
- `recordFailure` writes the audit row in a separate transaction so permanent
  failures survive the inner rollback. The redactor is wrapped in try/catch.

### Added

- `revenuecat.api()` factory resolves `appUserId` from
  `ctx.auth.getUserIdentity().subject` server-side. Spread it into your
  `convex/` file to close the IDOR class at the SDK layer. `getAppUserId` option
  overrides the default resolver.
- `revenuecat.registerRoutes(http, opts?)` shortcut. Defaults to
  `/webhooks/revenuecat`.
- Nine helpers: `getEntitlement`, `hasAnyEntitlement`, `isSubscriber`,
  `isInTrial`, `wasInTrialEver`, `getLatestSubscription`, `getRenewsAtMs`,
  `getExpiresAtMs`, `getConsumables`.
- `subscriptions.kind` (`"subscription"` or `"consumable"`).
  `getActiveSubscriptions` filters NON_RENEWING_PURCHASE rows out,
  `getConsumables` returns them. `subscriptions.backfillKind` migration patches
  pre-0.3.0 rows from the audit log.
- `transferParticipants` join table for O(per-user) GDPR purge.
  `transfers.backfillTransferParticipants` migration populates the table for
  pre-0.3.0 rows.
- `customers.countryCode` mirrored monotonically by `event_timestamp_ms`.
  `customers.managementUrl` populated by `syncSubscriber` from RC REST.

### Changed

- `cleanup.rateLimits` paginates with `runAfter(0)` continuation past the per-tx
  write cap.
- `by_app_user_product` compound index on `subscriptions`. Dropped unused
  `by_product`.
- `transfers.list` caps `limit` at 1000.

Reported by [@Nils-Fischer](https://github.com/Nils-Fischer) in
[#17](https://github.com/ramonclaudio/convex-revenuecat/issues/17).

## [0.2.1] - 2026-04-18

Three themes land together: a parity sweep against RevenueCat's iOS/Android SDKs
(correctness fixes), a dev toolchain refresh for April 2026, and a package
metadata overhaul. No breaking consumer API. One additive helper (`willRenew`).

### Upgrade notes

- **Peer dependency: `convex` now `^1.35.1`** (was `^1.31.6`). Matches what CI
  tests against. Prior ranges claimed support for older Convex versions that
  were never verified. Consumers on older Convex should upgrade. No code in this
  component requires a Convex API newer than 1.20.
- **Node 20+ required**: `engines.node` bumped from `>=18` to `>=20.0.0` (Node
  18 EOL'd April 2025).
- `Subscription.autoRenewStatus` now mirrors iOS `EntitlementInfo.willRenew` /
  Android `EntitlementInfoHelper.getWillRenew`: derived from five signals
  (lifetime, `PREPAID` period, `PROMOTIONAL` store, `unsubscribeDetectedAt`,
  `billingIssueDetectedAt`) rather than stored verbatim from webhooks. If you
  were reading the stored value as the raw user preference, switch to deriving
  from primitives or use the new `willRenew(sub)` client helper.
- `isInGracePeriod` and `getInGracePeriod` no longer require
  `expirationAtMs <= now`. Pre-expiry billing retry windows (Google Play fires
  `BILLING_ISSUE` before the current period ends) now return
  `inGracePeriod: true` as the iOS/Android SDKs do.

### Fixed

- `extendEntitlements` and `grantEntitlements` now preserve the prior
  `expiresAtMs` when a `RENEWAL` / `PRODUCT_CHANGE` / `REFUND_REVERSED` webhook
  arrives without `expiration_at_ms`. Convex `patch({ expiresAtMs: undefined })`
  REMOVES the field, which our gate reads as lifetime. A malformed partial
  payload could silently grant infinite access. Cross-referenced against iOS
  `EntitlementInfo.swift:255` and Android `DateHelper.kt:22`, both treat
  `expirationDate == nil` as lifetime.
- `processRenewal` now clears every stale period-specific marker on successful
  renewal: `billingIssueDetectedAt`, `gracePeriodExpirationAtMs`,
  `autoResumeAtMs`, `newProductId`, `expirationReason`, `unsubscribeDetectedAt`.
  Matches iOS `SubscriptionInfo.swift:44` contract: "If and when the billing
  issue gets resolved, this field is set to nil." Previously only the
  entitlement doc was cleared. The subscription doc carried phantom pending
  state into the next period.
- `processExpiration` now clears `autoResumeAtMs` and
  `gracePeriodExpirationAtMs`, and sets `autoRenewStatus: false`. Prior state
  leaked "resumes on ..." and grace-period UI signals onto already-dead subs.
- `processCancellation` with `cancel_reason === "BILLING_ERROR"` now sets
  `billingIssueDetectedAt`. RC's BILLING_ERROR cancel is the same logical state
  as a BILLING_ISSUE event (auto-retry gave up). Without the marker, derived
  `willRenew` and grace-period queries returned incoherent answers.
- `processBillingIssue` now sets `autoRenewStatus: false`. Mirrors iOS/Android
  `willRenew` which returns false whenever `billingIssuesDetectedAt != nil`.
- `processUncancellation` now clears `unsubscribeDetectedAt` so derived
  `willRenew` flips back to true.
- `upsertSubscription` now computes `autoRenewStatus` from the five-signal
  derivation after overrides land. Covers `PREPAID` period type and
  `PROMOTIONAL` store, which previously stored `autoRenewStatus: true` despite
  the SDKs returning `willRenew: false`.
- `transferEntitlements` and `aliasEntitlements` now pick the strictly more
  generous expiry (lifetime beats finite. Among finites, later wins) via a
  shared `isSourceMoreGenerous` helper. Closes a previously-open hole where a
  lifetime entitlement on either side could be regressed to the other's finite
  expiry, and where an out-of-order `TRANSFER` could overwrite a fresh
  destination renewal with stale source state.
- `transferSubscriptions` now dedups on `originalTransactionId`: if the
  destination already has a sub for the same transaction (retried TRANSFER, or
  race with a concurrent webhook ingest), the older record is dropped.
  Previously, two rows could share the same `originalTransactionId` across
  `appUserId` values.
- `processTransfer` and `processSubscriberAlias` now drop the source `customers`
  row (and its orphan entitlement/subscription/experiment audit rows) when the
  source is a `$RCAnonymousID:` ID and no active data remains. Matches the
  "anonymous ID is dead after merge" semantic that iOS `DeviceCache.clearCaches`
  and Android `deviceCache.clearCachesForAppUserID` apply client-side. Partial
  transfers are detected and skipped to preserve audit state.
- `sync.ts` ingestion now derives `autoRenewStatus` via the same helper as the
  webhook path, so REST and webhook paths converge on the same value.
  Previously, sync left `autoRenewStatus: undefined` because the field the code
  was reading (`auto_renew_status`) does not exist in RC's v1 REST response
  (verified against the v1 OpenAPI spec and both native SDK decoders). Dropped
  the speculative read alongside the derivation fix.
- `webhooks.ts`: removed an unreachable `status = "failed"` assignment and
  inlined error-message extraction inside the catch block. Flagged by ESLint
  10's `no-useless-assignment` rule. No runtime behavior change.
- `example/convex/tsconfig.json`: added `"types": ["node"]` so `process.env`
  resolves under TypeScript 6.

### Added

- `willRenew(sub)` client SDK helper that re-derives the five-signal check on
  read. Useful when mixing stored state with live adjustments or reading docs
  that pre-date the derivation logic.
- **Convex AI files** (`AGENTS.md`, `CLAUDE.md`, `skills-lock.json`,
  `example/convex/_generated/ai/guidelines.md`) generated by
  `npx convex ai-files install`. Ships the Convex-specific guidelines the
  toolchain expects so coding assistants working in the repo override stale
  patterns from training data. Matches the current Convex component template.

### Changed

- **`package.json` metadata pass**: `description` now matches the GitHub About
  blurb and mentions webhook + REST sync and lifecycle hooks. `author` moved
  from an invalid email stub to
  `{ name: "Ray", url: "https://github.com/ramonclaudio" }`. `keywords` expanded
  from 8 to 13 to match the GitHub topic list (`convex-component`, `gdpr`,
  `typescript`, `realtime`, `backend`, `serverless` added). `files` glob
  collapses four `*.test.*` patterns into a single `!**/*.test.*`. `jiti`
  alphabetized in devDependencies.
- **Dev dep pinning**: `convex`, `@vitest/coverage-v8`, and `pkg-pr-new`
  switched from caret to exact versions. Matches what CI tests against and what
  the Convex ecosystem pins (siblings `@convex-dev/action-cache` and the
  upstream template both pin `convex` exactly). `@vitest/coverage-v8` must match
  `vitest` exactly per vitest's own contract; `pkg-pr-new` is on `0.0.x` which
  has no semver guarantees.
- **Dev toolchain** refreshed for April 2026: `convex` → `1.35.1`, `convex-test`
  → `0.0.49`, `eslint` → `10.2.1` (+ `@eslint/js@10.0.1`,
  `@convex-dev/eslint-plugin@2.0.0`, new `jiti` peer), `typescript` → `6.0.3`,
  `vitest` → `4.1.4`, plus patch bumps on `@types/node`, `globals`, `prettier`,
  `typescript-eslint`.

### Removed

- `auto_renew_status` read in `sync.ts`. Not present in RC's v1 REST
  `/v1/subscribers/{id}` response per the published OpenAPI spec. Not decoded by
  iOS `CustomerInfoResponse.Subscription` or Android `SubscriptionInfoResponse`.
- `items` optional field from the `EventPayload` TypeScript type in
  `handlers.ts`. Not listed in RC's webhook event schema and never read by any
  handler. Speculative handling of undocumented fields is against
  `CONTRIBUTING.md`.
- **Unused scripts**: `dev:backend`, `all`, `version`, `prepack`,
  `prepublishOnly`, `preversion`, `alpha`, `release` from `package.json`.
  `dev:backend` is covered by `dev` via Convex 1.34+'s `--start` flag. `all` was
  an unused composite. `version` was a vim CHANGELOG hook. `prepack` /
  `prepublishOnly` don't fire in practice because publish runs from
  `.github/workflows/publish.yml` on tag push. `preversion` / `alpha` /
  `release` don't fire either because the `release` skill tags directly instead
  of calling `npm version`.
- **`npm-run-all2`** and **`path-exists-cli`** dev dependencies. `validate` is
  now serial (`npm test && npm run lint && npm run typecheck`), removing the
  last need for `run-p`. `predev` uses `convex init` instead of `path-exists`.
- **`.github/assets/`** directory with two unreferenced SVG icons.
- **`renovate.json`**: Renovate GitHub App is not installed on the repo (zero
  PRs ever opened by `renovate[bot]`). Dead template artifact.
- **`initTemplate.mjs` reference** in `eslint.config.js` ignores. File doesn't
  exist in this repo. Stale leftover from the Convex component template.
- **`/docs/.vitepress/cache` and `explorations`** from `.gitignore`. Neither
  directory exists.
- **`rollup` override** (not present in the dep tree) and the **`ajv` override**
  (no longer needed now that `eslint@10` removed its `ajv@6` transitive path).

## [0.2.0] - 2026-04-18

### Upgrade notes

Two user-visible behavior changes from 0.1.x. Both are correctness fixes. No
consumer code changes required.

- **Refunded users lose access immediately.** Was leaked until `EXPIRATION`.
  Refunds are detected on `CANCELLATION` when
  `cancel_reason === "CUSTOMER_SUPPORT"` OR `price < 0`, and entitlements revoke
  on the same event. If you were depending on the old leak window (e.g. keeping
  access through an Apple Report-a-Problem refund until the natural period end),
  your refund funnel narrows.
- **Billing-issue access is bounded by `grace_period_expiration_at_ms`.** Was
  unbounded if `EXPIRATION` dropped. `hasEntitlement` no longer short-circuits
  on `billingIssueDetectedAt`; `processBillingIssue` folds the grace end into
  `expiresAtMs` so access stops at grace end as a hard ceiling even if
  `EXPIRATION` never arrives.

### Fixed

- **Empty-string `REVENUECAT_WEBHOOK_AUTH` silently disabled auth.**
  `if (expectedAuth)` treated `""` as "no auth configured" and accepted
  unauthenticated requests, letting anyone write arbitrary subscription state
  for any `app_user_id`. Common footgun:
  `process.env.REVENUECAT_WEBHOOK_AUTH ?? ""`. The `RevenueCat` constructor now
  throws on empty-string auth. Omit the field entirely to run without auth
  (strongly discouraged).
- **`ownership_type: "UNKNOWN"` crashed the mutation.** Android SDK emits
  `UNKNOWN` as a real wire value when the store doesn't report ownership
  (`EntitlementInfo.kt` ownership enum). Our validator rejected it, triggering 5
  RC retries then permanent event drop. Added `UNKNOWN` to
  `ownershipTypeValidator`; `mapOwnership` normalizes any unknown string to
  `undefined` for forward compat.
- **`mapPeriodType` had no unknown-value fallback.** `sync.ts` cast
  `s.toUpperCase() as "NORMAL"` and relied on runtime validation to succeed. A
  future RC period_type would crash the whole sync. Now falls back to `NORMAL`
  like Android's `optPeriodType` default.
- **REST sync dropped ALL subscription pricing data.** `sync.ts` never read
  `s.price` from RC's `/v1/subscribers/{id}` response. Paying users reconciled
  via sync had `priceUsd: undefined`, `currency: undefined`,
  `priceInPurchasedCurrency: undefined`. Revenue reporting silently wrong. Now
  reads and coerces (Android SDK types `amount` as `Double`. Test fixtures show
  string too). Non-subscriptions and subscriptions both fixed.
- **Rate limit consumed BEFORE dedup check** opened a DoS vector: attacker with
  one valid `event.id` could replay 100×/min, each exhausting a rate-limit slot
  via dedup-short-circuit. Real RC webhooks would then get 429'd and dropped
  after 5 retries. Dedup now runs first so replays cost nothing.
- **`transferEntitlements` dropped `ownershipType`, `billingIssueDetectedAt`,
  `unsubscribeDetectedAt`.** Same bug class fixed for `aliasEntitlements` in
  0.1.9/0.1.10. Regressed when 0.2.0 added `ownershipType` at the entitlement
  level. Family-share TRANSFER lost ownership. Restore mid-grace lost the
  billing-issue marker. Now mirrors the aliasEntitlements conditional-spread
  pattern.
- **`deleteCustomer` didn't purge the `transfers` table.** GDPR gap: the user's
  `app_user_id` stayed inside `transferredFrom`/`transferredTo` arrays forever
  after "erasure." Now scans transfers (bounded by `PURGE_SAFETY_CAP`) and
  deletes any row referencing the user. `DeleteCustomerResult` gains a
  `transfers: number` count.
- **`processRefundReversed` left stale refund markers.** Reversing a refund
  (store clawed it back) kept `refundedAtMs` set and
  `cancelReason: "CUSTOMER_SUPPORT"` on the subscription. Dashboards flagging
  refunded customers stayed wrong. Now clears both and forces
  `autoRenewStatus: true`.
- **`RENEWAL` didn't clear `autoResumeAtMs`** after a pause→resume. A
  previously-paused subscription that successfully renewed kept a phantom resume
  date. Now cleared alongside the other resume-state fields.
- **Legacy singular `entitlement_id` was validated but NEVER read.** All 12 call
  sites read `entitlement_ids` (plural). Long-running projects still emitting
  the singular form got zero entitlement grants, revokes, or transfers. Added
  `getEntitlementIds(event)` normalizer used throughout.
- **`PRODUCT_CHANGE` didn't propagate to entitlements.** Between PRODUCT_CHANGE
  and the subsequent RENEWAL, `entitlement.productId` stayed wrong. Now calls
  `extendEntitlements` when entitlement_ids are present. Also:
  `extendEntitlements` now updates `productId` on existing rows (previously only
  updated `expiresAtMs` / `ownershipType`).
- **`VIRTUAL_CURRENCY_TRANSACTION` dropped events using
  `purchase_environment`.** Real RC VC events carry `purchase_environment`, not
  top-level `environment`. Our handler short-circuited before processing,
  silently under-reporting game-app balances. Now accepts either field.
- **`UNSUBSCRIBE` cancellations didn't set
  `subscription.unsubscribeDetectedAt`.** Consumers couldn't distinguish "will
  not renew" from refunds and billing errors. Now populated from
  `event.event_timestamp_ms` on `CANCELLATION` with
  `cancel_reason: "UNSUBSCRIBE"`.
- **`revokeEntitlements` did a full-table scan per user.** Every EXPIRATION /
  CANCELLATION-with-refund `.collect()`-ed ALL of a user's entitlements, then
  filtered in memory. Heavy users (accumulated history across alias migrations,
  renewals) triggered OCC retries and eventually dropped webhooks. Now uses the
  `by_app_user_entitlement` compound index for specific IDs. The no-IDs fallback
  scan is retained but guarded upstream.
- **Non-subscription purchases defaulted to `APP_STORE` when `store` was
  missing.** Silently misattributed Android/Stripe/Amazon one-time purchases to
  iOS on reporting dashboards. Now falls back to `UNKNOWN_STORE` like the
  subscription path.
- **Non-subscription purchases lost `ownership_type` and
  `original_purchase_date`.** One-time purchases now default
  `ownershipType: "PURCHASED"` (REST doesn't carry ownership on non_subs) and
  capture `originalPurchasedAtMs` for tenure/loyalty queries.
- **`sync.ingest` patch retained stale `autoRenewStatus` / `cancelReason`.**
  REST is advertised as authoritative, but `sync` wasn't touching these fields.
  A user who re-enabled auto-renew through RC support whose webhook was dropped
  would stay stuck as cancelled. Sync now clears `cancelReason` on every patch
  and reads `auto_renew_status` from REST when present.
  `unsubscribe_detected_at` also now persisted.
- **`sync.ingest` was strict `v.object` for the `subscriber` arg.** Same bug
  class fixed for webhook handlers in this release. RC's REST response carries
  many top-level fields we don't consume (`management_url`,
  `last_purchase_date`, `first_seen_attribution_network_info`, etc.). A strict
  validator rejected real responses. Now `v.any()` with the TypeScript
  `RevenueCatSubscriber` type as documentation.
- **`event.id` had no length cap.** Authenticated attacker could write 1MB event
  IDs, bloating the `webhookEvents` table and its `by_event_id` index. 30-day
  retention × 100/min × 1MB = ~4.3GB of wasted storage. Now capped at 128 bytes
  at the HTTP handler AND the component mutation boundary.
- **`processTransfer` polluted customer aliases.** Upserting each participant
  customer spread the event's `aliases` array onto every one, so source users'
  customer records accumulated unrelated aliases. Now strips `aliases` before
  per-user upsert.
- **SUBSCRIBER_ALIAS didn't migrate experiment enrollments.** A/B-test
  attribution broke on anon→real login: experiment rows stayed keyed under
  `$RCAnonymousID:...`. Added `aliasExperiments` helper, wired into
  `processSubscriberAlias` with the same 500-record safety cap.
- **Refunded users kept access until `EXPIRATION`.** As of 2026 RevenueCat does
  not emit a distinct `REFUND` event. Refunds arrive as `CANCELLATION` with
  `cancel_reason: "CUSTOMER_SUPPORT"` and/or a negative `price`. The old
  `processCancellation` only updated `cancelReason` + `autoRenewStatus: false`,
  leaving entitlements active. Now revokes entitlements when
  `cancel_reason === "CUSTOMER_SUPPORT"` OR `price < 0`. Checking cancel_reason
  alone misses Google Play self-serve refunds and dashboard refunds where
  `cancel_reason` stays `DEVELOPER_INITIATED`. Legacy `processRefund` handler
  retained defensively for older projects.
- **`autoRenewStatus` was force-set to `false` on every CANCELLATION, including
  refunds.** Per RC docs, refunds can be issued without deactivating
  auto-renewal: "refunds can be given without cancelling a subscription." Now
  `autoRenewStatus` is only forced to `false` for genuine cancellations
  (UNSUBSCRIBE, BILLING_ERROR, DEVELOPER_INITIATED, PRICE_INCREASE, UNKNOWN).
  Refund-only cases (CUSTOMER_SUPPORT or negative price) leave the existing
  value alone so a subsequent RENEWAL arrives truthfully.
- **Handler validators rejected unknown webhook fields.**
  `eventPayloadValidator` was a strict `v.object`, causing RC's documented "we
  may add new fields without versioning" path to throw at validation, triggering
  5 retries then permanent drop. Handlers now accept `v.any()` and cast to
  `EventPayload` internally. The validator is retained only as the source of the
  `EventPayload` TypeScript type. Added a regression test that sends a payload
  with fields not in the validator.
- **Store enum missing `GALAXY`, `EXTERNAL`, `UNKNOWN_STORE`.** Cross-audit
  against iOS 5.68.0 (`EntitlementInfo.swift:22-60`) and Android 10.2.0
  (`EntitlementInfo.kt:183-289`) confirmed these are live SDK values; Galaxy is
  already shipping OTP purchases (Android 10.1.0). Our validator would reject a
  Samsung Galaxy Store customer, an External Purchases API entitlement, or any
  RC-unknown store. Added all three. Also added `normalizeStore` helper in the
  HTTP handler that maps the Android wire form `"unknown"` to `UNKNOWN_STORE`
  before the outer schema validator sees it.
- **`ownership_type` not persisted on entitlements.** Webhooks and REST both
  carry `ownership_type` (PURCHASED vs FAMILY_SHARED) at the subscription level.
  Consumers need this at the entitlement level to enforce single-seat products.
  Added `entitlements.ownershipType` and populate from `event.ownership_type` on
  every grant/extend/sync. Webhook test added.
- **`refunded_at` not persisted.** When a refund is detected in CANCELLATION, we
  now set `subscription.refundedAtMs = event.event_timestamp_ms`.
  `syncSubscriber` also propagates
  `subscriber.subscriptions[productId].refunded_at`. Audit trail for reporting.
- **`original_purchase_date` not persisted.** Distinct from `purchasedAtMs`
  (which updates on each renewal). `sync.ts` now stores `originalPurchasedAtMs`
  from the REST `original_purchase_date` for tenure/loyalty queries.
- **BILLING_ISSUE could convert a lifetime entitlement to finite expiry.** If a
  lifetime entitlement (`expiresAtMs === undefined`) received a BILLING_ISSUE
  webhook with `grace_period_expiration_at_ms` set, the old logic
  `graceEnd && (!ent.expiresAtMs || ...)` treated `undefined` as "needs
  extension" and set `expiresAtMs = graceEnd`. Low-probability in practice
  (lifetime products don't receive billing retries) but access-gating wrong in
  principle, after graceEnd, the previously-lifetime entitlement would start
  returning `false`. Now guards with `ent.expiresAtMs !== undefined` before
  extending. Regression test added.
- **`sync.ts` aborted the entire ingest on an unknown `store` value.** If RC
  introduces a new store before our schema gets bumped, `mapStore` would produce
  an unknown uppercase value that fails `storeValidator`, throwing the mutation.
  Now maps unknown values to `UNKNOWN_STORE` (matches the SDK's own
  `StoreSerializer` default). Regression test added.
- **`isFamilyShare` and `ownershipType` could drift on handler path.** If a
  webhook arrived with `ownership_type: "FAMILY_SHARED"` but no
  `is_family_share` field, we stored `isFamilyShare: false` +
  `ownershipType: "FAMILY_SHARED"`, contradictory. Now derives `isFamilyShare`
  from `ownership_type` when `is_family_share` is absent. `sync.ts` already
  derived consistently.
- **Legacy `processRefund` didn't persist `refundedAtMs`.** For symmetry with
  the CANCELLATION refund path.
- **`billingIssueDetectedAt` short-circuit leaked access indefinitely.** Old
  `hasEntitlement` returned true whenever the flag was set, regardless of
  `expiresAtMs`. If `EXPIRATION` failed to arrive after grace, a non-paying user
  kept access forever. Now mirrors the iOS SDK's `EntitlementInfo.isActive`:
  pure `expiresAtMs > now`. Grace period is encoded into `expiresAtMs` by
  `processBillingIssue` (extends entitlement `expiresAtMs` to the
  `grace_period_expiration_at_ms`) and `sync.ts` (folds
  `grace_period_expires_date` into the effective expiry). `EXPIRATION` still
  revokes at grace end. If dropped, access correctly stops at the grace end hard
  ceiling instead of running forever.
- **`cleanup.webhookEvents` cron capped at 500 deletes/day.** Took the 500
  oldest rows, deleted only those past the 30-day cutoff, then returned. Under
  inflow > 500/day the table grew unboundedly. Now paginates until either cutoff
  is reached or a per-invocation safety cap (4000) is hit. If more work remains,
  schedules a continuation immediately instead of waiting 24h.
- **`autoRenewStatus` was set to `undefined` on `RENEWAL`.** A successful
  renewal implies auto-renew is on. Ambiguity is wrong. Now explicitly `true`.
- **`upsertSubscription` silently no-opped on missing required fields.** Added a
  `console.warn` enumerating the missing fields and the event ID so ops can
  investigate. Function now returns a boolean.

### Added

- **`RevenueCatOptions.redactPayload`**, optional function run on every webhook
  payload before it's stored in the `webhookEvents` audit table. Defaults to
  stripping RC-reserved PII keys (`$email`, `$phoneNumber`, `$apnsTokens`,
  `$fcmTokens`, `$displayName`, `$ip`, etc.) from `subscriber_attributes`. Pass
  a custom function to control what gets stored. Pass `"off"` to disable (not
  recommended). 30-day retention still applies.
- **`decodeSubscriberAttributes(attrs)`**, exported client-SDK helper that
  reverses the `__dollar__` encoding on customer attribute keys. Consumers
  reading `customer.attributes` pipe through this to get back `$email`,
  `$phoneNumber`, etc. as RC documents them. Required because Convex rejects `$`
  at every nesting level, so the component stores encoded keys.
- **`subscription.unsubscribeDetectedAt`**, set on CANCELLATION with
  `cancel_reason: "UNSUBSCRIBE"` and from REST `unsubscribe_detected_at`.
  Distinguishes user-initiated "will not renew" from refund/billing-error
  cancels in consumer UI.
- **Lifecycle hooks.** `RevenueCatOptions.hooks` accepts three optional
  FunctionReferences that fire from inside the component mutation that made the
  state change:
  - `onEntitlementActivated(ctx, { appUserId, entitlementId, productId?, purchasedAtMs?, expiresAtMs?, store?, ownershipType?, isSandbox, sourceEventType })`,
    fires when an entitlement moves from not-active to active (INITIAL_PURCHASE,
    RENEWAL, REFUND_REVERSED, TRANSFER onto a user, SUBSCRIBER_ALIAS, or
    sync-detected activation).
  - `onEntitlementDeactivated(ctx, { appUserId, entitlementId, productId?, purchasedAtMs?, expiresAtMs?, store?, ownershipType?, isSandbox, sourceEventType })`,
    fires on EXPIRATION, refund CANCELLATION, TRANSFER off a user, or sync
    reconciliation. Reports the entitlement's state BEFORE deactivation.
  - `onCustomerDeleted(ctx, { appUserId })`, fires after `deleteCustomer` purges
    rows.

  Scheduling is atomic with the enclosing mutation, rollback discards scheduled
  hook writes. Webhook retries (same `event.id`) don't double-fire because the
  outer dedup short-circuits before the snapshot runs. Hooks themselves run
  AFTER the mutation commits via Convex's scheduler. A hook throwing does NOT
  retry the webhook (scheduled mutations retry exactly-once, actions
  at-most-once. Make hooks idempotent). Function references are converted to
  `FunctionHandle` strings via Convex's `createFunctionHandle` before crossing
  the component boundary.

  `sourceEventType` carries the RC webhook `event.type` that caused the
  transition (e.g., `"INITIAL_PURCHASE"`, `"EXPIRATION"`) or `"SYNC"` when
  detected by `syncSubscriber`. Lets consumers branch without inspecting every
  entitlement's prior state.

  Transition-detection snapshots only run when at least one hook is configured.
  Consumers without hooks pay zero overhead per webhook/sync.

  `affectedUserIds` covers `app_user_id`, `original_app_user_id`,
  `transferred_from`, `transferred_to`, and `aliases`, so SUBSCRIBER_ALIAS
  migrations between anon and real IDs correctly fire hooks for both.

- **`deleteCustomer(ctx, { appUserId })`** client method. Purges all
  component-local rows for a user: customer, subscriptions, entitlements,
  experiments, invoices, virtual currency balances/transactions, and
  webhookEvents. Does not call RevenueCat's REST API. Pair with
  `DELETE /v1/subscribers/{app_user_id}` from an action if you also want to
  purge RC-side (GDPR).
- **`syncSubscriber` hydrates `non_subscriptions`.** One-time/lifetime purchases
  from `GET /v1/subscribers/{id}` are now ingested into the `subscriptions`
  table alongside subscriptions. Returns
  `{ subscriptions, entitlements, nonSubscriptions }`.
- **Experiment upserts run on every event with an `experiments[]` array**, not
  just purchase events. RC includes the array on every event. Mid-cycle
  re-enrollments are now captured.
- **Transfer/alias/purge operations cap at 500 records per user** to stay under
  Convex's per-transaction write budget. Pathological accounts throw
  `TRANSFER_SAFETY_CAP_EXCEEDED` / `PURGE_SAFETY_CAP_EXCEEDED` instead of
  silently corrupting state.

### Changed

- **Dropped the unused `by_active` index** on the `entitlements` table. No query
  reads it.
- **Tightened `ClientComponentApi` return types.** Removed `any[]` / `any` from
  query/mutation references. Clients now get proper `Entitlement[]`,
  `Subscription[]`, `Customer | null`, etc. from the component type definition.
- **Consolidated validators** in `invoices.ts`, `transfers.ts`,
  `virtualCurrency.ts`, `webhookEvents.ts` to use
  `schema.tables.X.validator.extend({ _id, _creationTime })` instead of
  duplicating field lists.
- **README rewrite.** Documents: RC does not sign webhooks (no HMAC, no
  `X-RevenueCat-Signature`); RC's retry policy (5 retries at 5/10/20/40/80 min,
  60s timeout); SUBSCRIBER_ALIAS deprecation status; RC REST API rate limits per
  domain; GDPR delete flow.

## 0.1.11

### Added

- **Subscriber sync from REST API.** New
  `syncSubscriber(ctx, { appUserId, subscriber })` method accepts the
  `subscriber` object from RevenueCat's `GET /v1/subscribers/{app_user_id}`
  endpoint. Upserts customer, subscriptions, and entitlements to match
  RevenueCat's source of truth. Covers initial backfill, dropped webhooks, and
  on-foreground reconciliation. All writes are idempotent.
- **Webhook reconciliation with sync-created records.** `upsertSubscription`
  falls back to `(appUserId, productId)` lookup when `originalTransactionId`
  doesn't match, so webhooks arriving after a sync update the existing record
  instead of creating a duplicate. Patches `originalTransactionId` to the
  correct value on match.
- **`RevenueCatSubscriber` and `SyncResult` types** exported from the client
  SDK.

### Changed

- Rewrote README. Dropped mermaid diagram, collapsible sections, and FAQ. Sync
  docs inline with usage.
- Updated `convex` to 1.34.1, `convex-test` to 0.0.46, `vitest` to 4.1.2,
  `@vitest/coverage-v8` to 4.1.2, `@convex-dev/eslint-plugin` to 1.2.1,
  `@types/node` to 25.5.0, `typescript-eslint` to 8.58.0, `pkg-pr-new` to
  0.0.66.

### Removed

- Deleted `PUBLISHING.md` (stale template, publishing is handled by GitHub
  Actions on tag push).

## 0.1.10

### Fixed

- **`aliasEntitlements` dropped `unsubscribeDetectedAt` on merge.** Same hole as
  `billingIssueDetectedAt` in 0.1.9. The `sourceIsNewer` patch didn't carry
  `unsubscribeDetectedAt` from the source record. No handler sets it yet, but
  the field is in the schema and the gap was there. Fixed: same conditional
  spread pattern as `billingIssueDetectedAt`.

## 0.1.9

### Fixed

- **`REFUND` not handled.** RC sends it when a refund goes through. Was falling
  through to `"ignored"`. Refunded users kept their entitlements. Added
  `processRefund`: upserts customer and subscription, revokes entitlements if
  `entitlement_ids?.length` is set. Same guard as `EXPIRATION`.
- **`aliasEntitlements` dropped `billingIssueDetectedAt` on merge.** The
  `sourceIsNewer` patch in `SUBSCRIBER_ALIAS` didn't copy
  `billingIssueDetectedAt` from the source record. Anon user with a billing
  issue on their ID lost grace-period access after login. Fixed: copies it from
  source when source has it. Leaves destination's value alone otherwise.

## 0.1.8

### Changed

- Updated `convex` to 1.32.0, `typescript-eslint` to 8.56.1, `globals` to
  17.4.0, `@types/node` to 24.11.0, `pkg-pr-new` to 0.0.65.
- Pinned `rollup` to `^4.59.0` and `ajv` to `^6.14.0` via overrides to resolve
  high and moderate audit vulnerabilities in transitive dependencies. Dropped
  `minimatch` override, `typescript-eslint@8.56.1` switched to `tinyglobby`. 0
  vulnerabilities across all severities.

## 0.1.7

### Fixed

- **SUBSCRIBER_ALIAS missing entitlement migration.** `logIn(realId)` updated
  the customer record but left entitlements under `$RCAnonymousID:xxx`.
  `hasEntitlement(realId)` returned false until next renewal. Added
  `aliasEntitlements` to re-assign (or conflict-merge by expiry) all
  entitlement/subscription records from `original_app_user_id` to `app_user_id`.
- **EXPIRATION revoked all entitlements when `entitlement_ids` was absent.** RC
  sends null for products not mapped to any entitlement. After transform that
  became `undefined`, which hit a "revoke everything" path in
  `revokeEntitlements`. Added `entitlement_ids?.length` guard.
- **RENEWAL and SUBSCRIPTION_EXTENDED silently skipped missing entitlement
  records.** `extendEntitlements` only patched existing rows. If the record was
  missing (race condition, prior transfer), user stayed locked out after a
  successful charge. Added an insert fallback.
- **Virtual currency dedup broken for multi-currency events.** Dedup used
  `transactionId` alone. A single event can carry adjustments for multiple
  currencies with the same `transactionId`. Second currency's record was
  skipped. Added `.filter(currencyCode)`.
- **RENEWAL kept stale cancellation state.** `cancelReason` and
  `autoRenewStatus` from a prior cancellation cycle weren't cleared on renewal.
  Both are reset now.
- **Dead `ctx.db.insert` in webhook catch block.** Throwing rolls back the
  transaction, so the insert was always discarded. Removed it.

## 0.1.6

### Fixed

- **Client type compatibility**, Defined `ClientComponentApi` with explicit
  function signatures using `"public" | "internal"` visibility union. Convex
  generates component types with "internal" visibility in consumer apps
  regardless of how they're defined in the component source.

## 0.1.5

### Fixed

- **Query visibility**, Changed `invoices`, `transfers`, and `virtualCurrency`
  query functions from `internalQuery` to `query` (public) so they can be
  accessed via the client SDK.

## 0.1.4

### Added

- **Transfers table**, `TRANSFER` events now store transfer records with
  `transferredFrom`, `transferredTo`, and `entitlementIds`. Query with
  `getTransfer()` and `getTransfers()`.
- **Invoices table**, `INVOICE_ISSUANCE` events (Web Billing) now store invoice
  data including `invoiceId`, `appUserId`, `productId`, pricing. Query with
  `getInvoice()` and `getInvoices()`.
- **Virtual currency tracking**, `VIRTUAL_CURRENCY_TRANSACTION` events now:
  - Store individual transactions in `virtualCurrencyTransactions` table
  - Maintain running balances in `virtualCurrencyBalances` table
  - Query with `getVirtualCurrencyBalance()`, `getVirtualCurrencyBalances()`,
    `getVirtualCurrencyTransactions()`
- **`ownership_type` field**, Subscriptions now track `PURCHASED` vs
  `FAMILY_SHARED` to distinguish direct purchases from Family Sharing. Available
  in schema, handlers, and exported types.
- **Grace period queries**, New `isInGracePeriod(originalTransactionId)` and
  `getSubscriptionsInGracePeriod(appUserId)` methods to check if subscriptions
  are in billing retry period. Per RevenueCat docs, users should retain access
  during grace period.
- **Subscription transfer on TRANSFER**, `TRANSFER` events now update
  `appUserId` on subscriptions table, not just entitlements. Ensures
  `getSubscriptions(appUserId)` returns transferred subscriptions.

### Fixed

- **TRANSFER handler missing customer upsert**, Source and destination users are
  now properly upserted to customers table.
- **Webhook validation fails for undocumented RevenueCat fields**, Added
  `takehome_percentage` and `entitlement_id` to event payload validator.
- **INVOICE_ISSUANCE uses event.id**, The handler was looking for a nonexistent
  `invoice_id` field. Now correctly uses the event's `id` as the invoice
  identifier per RevenueCat sample events.
- **Component type generation**, Changed `transfers`, `invoices`, and
  `virtualCurrency` queries from `internalQuery` to `query` so Convex generates
  proper types for consumer apps.

### Changed

- **Typed `adjustments` field**, Virtual currency adjustments now have proper
  typing: `{ amount: number, currency: { code, name, description? } }[]` instead
  of `v.any()`.
- **Added `enrolled_at_ms` field**, Top-level field for `EXPERIMENT_ENROLLMENT`
  events.
- **Added documentation comments**, Deprecated fields and field purposes now
  have inline comments.
- **Auth header handling**, Now supports both raw token and `Bearer <token>`
  formats. Uses constant-time comparison to prevent timing attacks.

## 0.1.3

### Fixed

- **Client type compatibility**, Changed `ComponentApi` to `ClientComponentApi`
  using `Pick<>` to only require the specific methods the client uses. Fixes
  type errors when deployments have different component versions.

## 0.1.2

### Changed

- **Removed node:crypto dependency**, Webhook auth now uses simple string
  comparison instead of `timingSafeEqual`. Convex runtime doesn't support
  node:crypto, and timing attacks are mitigated by rate limiting + random
  32-byte secrets.

## 0.1.1

### Fixed

- **Webhook processing fails with null values**, RevenueCat sends explicit
  `null` for optional fields, but Convex's `v.optional()` expects absent keys
  (not null values). Object keys with null values are now removed, making them
  absent. Array elements are preserved since `null` is a valid Convex value
  (unlike `undefined` which is not).
- **Bundling fails in non-Node environments**, Top-level `node:crypto` import
  caused bundlers to fail. Now lazily imported only when webhook auth is
  configured.

### Changed

- Merged `stripNulls` and `encodeReservedKeys` into single `transformPayload`
  function for cleaner, single-pass payload processing.

## 0.1.0

- Webhook processing for all 18 RevenueCat event types
- Customer, subscription, entitlement, and experiment tracking
- Idempotent event processing with deduplication
- Rate limiting (100 req/min per app)
- Webhook event audit log with 30-day retention
- Client SDK with 8 query methods and HTTP webhook handler
- Test helpers for convex-test integration
- 113 tests
