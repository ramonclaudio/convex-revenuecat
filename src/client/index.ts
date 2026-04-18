import { createFunctionHandle, httpActionGeneric } from "convex/server";
import type { GenericActionCtx, GenericDataModel, FunctionReference } from "convex/server";
import type {
  Customer,
  Entitlement,
  Environment,
  Experiment,
  Invoice,
  OwnershipType,
  Store,
  Subscription,
  Transfer,
  VirtualCurrencyBalance,
  VirtualCurrencyTransaction,
} from "../component/types.js";

// Convex generates component types with "internal" visibility in consumer apps
// regardless of how they're defined in the component. Define the expected API
// shape directly to avoid visibility mismatches.
type AnyVisibility = "public" | "internal";

type GracePeriodReturn = {
  inGracePeriod: boolean;
  gracePeriodExpiresAt?: number;
  billingIssueDetectedAt?: number;
};

type ClientComponentApi = {
  entitlements: {
    check: FunctionReference<"query", AnyVisibility, { appUserId: string; entitlementId: string }, boolean>;
    getActive: FunctionReference<"query", AnyVisibility, { appUserId: string }, Entitlement[]>;
    list: FunctionReference<"query", AnyVisibility, { appUserId: string }, Entitlement[]>;
  };
  subscriptions: {
    getActive: FunctionReference<"query", AnyVisibility, { appUserId: string }, Subscription[]>;
    getByUser: FunctionReference<"query", AnyVisibility, { appUserId: string }, Subscription[]>;
    isInGracePeriod: FunctionReference<"query", AnyVisibility, { originalTransactionId: string }, GracePeriodReturn>;
    getInGracePeriod: FunctionReference<"query", AnyVisibility, { appUserId: string }, Subscription[]>;
  };
  customers: {
    get: FunctionReference<"query", AnyVisibility, { appUserId: string }, Customer | null>;
    purge: FunctionReference<"mutation", AnyVisibility, { appUserId: string; onCustomerDeleted?: string }, DeleteCustomerResult>;
  };
  experiments: {
    get: FunctionReference<"query", AnyVisibility, { appUserId: string; experimentId: string }, Experiment | null>;
    list: FunctionReference<"query", AnyVisibility, { appUserId: string }, Experiment[]>;
  };
  transfers: {
    getByEventId: FunctionReference<"query", AnyVisibility, { eventId: string }, Transfer | null>;
    list: FunctionReference<"query", AnyVisibility, { limit?: number }, Transfer[]>;
  };
  invoices: {
    get: FunctionReference<"query", AnyVisibility, { invoiceId: string }, Invoice | null>;
    listByUser: FunctionReference<"query", AnyVisibility, { appUserId: string }, Invoice[]>;
  };
  virtualCurrency: {
    getBalance: FunctionReference<"query", AnyVisibility, { appUserId: string; currencyCode: string }, VirtualCurrencyBalance | null>;
    listBalances: FunctionReference<"query", AnyVisibility, { appUserId: string }, VirtualCurrencyBalance[]>;
    listTransactions: FunctionReference<"query", AnyVisibility, { appUserId: string; currencyCode?: string }, VirtualCurrencyTransaction[]>;
  };
  webhooks: {
    process: FunctionReference<"mutation", AnyVisibility, { event: { id: string; type: string; app_id?: string; app_user_id?: string; environment: Environment; store?: Store }; payload: Record<string, unknown>; hooks?: { onEntitlementActivated?: string; onEntitlementDeactivated?: string } }, { processed: boolean; eventId: string; rateLimited?: boolean }>;
  };
  sync: {
    ingest: FunctionReference<"mutation", AnyVisibility, { appUserId: string; subscriber: RevenueCatSubscriberInput; hooks?: { onEntitlementActivated?: string; onEntitlementDeactivated?: string } }, SyncResult>;
  };
};

type RevenueCatSubscriberInput = {
  entitlements?: Record<string, unknown>;
  subscriptions?: Record<string, unknown>;
  non_subscriptions?: Record<string, unknown>;
  subscriber_attributes?: Record<string, unknown>;
  first_seen?: string;
  last_seen?: string;
  original_app_user_id?: string;
};

export type {
  Store,
  Environment,
  PeriodType,
  OwnershipType,
  Entitlement,
  Subscription,
  Customer,
  Experiment,
  Transfer,
  Invoice,
  VirtualCurrencyBalance,
  VirtualCurrencyTransaction,
} from "../component/types.js";

/** Shape of the `subscriber` object from RevenueCat's GET /v1/subscribers/{id}. */
export type RevenueCatSubscriber = {
  entitlements?: Record<
    string,
    {
      expires_date: string | null;
      grace_period_expires_date?: string | null;
      product_identifier: string;
      purchase_date: string;
    }
  >;
  first_seen: string;
  last_seen?: string;
  original_app_user_id?: string;
  subscriber_attributes?: Record<
    string,
    { value: string; updated_at_ms: number }
  >;
  subscriptions?: Record<
    string,
    {
      auto_resume_date?: string | null;
      billing_issues_detected_at?: string | null;
      expires_date: string | null;
      grace_period_expires_date?: string | null;
      is_sandbox: boolean;
      original_purchase_date: string;
      period_type: string;
      purchase_date: string;
      refunded_at?: string | null;
      store: string;
      store_transaction_id?: string;
      unsubscribe_detected_at?: string | null;
      ownership_type?: string;
    }
  >;
  non_subscriptions?: Record<
    string,
    Array<{
      id: string;
      is_sandbox: boolean;
      purchase_date: string;
      store: string;
    }>
  >;
};

export type SyncResult = {
  subscriptions: number;
  entitlements: number;
  nonSubscriptions: number;
};

export type DeleteCustomerResult = {
  customer: number;
  subscriptions: number;
  entitlements: number;
  experiments: number;
  invoices: number;
  virtualCurrencyBalances: number;
  virtualCurrencyTransactions: number;
  webhookEvents: number;
  transfers: number;
};

/**
 * Mirror of iOS `EntitlementInfo.willRenew` / Android `EntitlementInfoHelper.getWillRenew`.
 *
 * The component already stores a derived `autoRenewStatus` on every subscription
 * upsert (webhook and sync paths). This helper lets consumers re-derive on
 * read from a `Subscription` doc, useful when mixing stored state with
 * live adjustments or when reading a doc that pre-dates the derivation logic.
 *
 * Returns false for lifetime, prepaid, promotional, unsubscribed, or
 * billing-issue subs. Matches the five-signal check in both native SDKs.
 */
export function willRenew(
  sub: Pick<
    Subscription,
    | "periodType"
    | "store"
    | "expirationAtMs"
    | "unsubscribeDetectedAt"
    | "billingIssueDetectedAt"
  >,
): boolean {
  if (sub.expirationAtMs === undefined) return false;
  if (sub.periodType === "PREPAID") return false;
  if (sub.store === "PROMOTIONAL") return false;
  if (sub.unsubscribeDetectedAt !== undefined) return false;
  if (sub.billingIssueDetectedAt !== undefined) return false;
  return true;
}

/**
 * Decode encoded subscriber attribute keys back to RC's documented names.
 *
 * The component stores `subscriber_attributes` with `__dollar__email` rather
 * than `$email` because Convex rejects `$` at every nesting level. Consumers
 * querying `customer.attributes` should pipe through this helper to get back
 * the RC-native key names (`$email`, `$phoneNumber`, etc.) that downstream
 * analytics/CRM pipelines expect.
 */
export function decodeSubscriberAttributes<T>(
  attrs: Record<string, T> | undefined,
): Record<string, T> | undefined {
  if (!attrs) return undefined;
  const result: Record<string, T> = {};
  for (const [key, value] of Object.entries(attrs)) {
    const decoded = key.startsWith("__dollar__") ? `$${key.slice(10)}` : key;
    result[decoded] = value;
  }
  return result;
}

/**
 * Keys considered PII in RC's subscriber_attributes. These are the RC-reserved
 * `$`-prefixed attributes that carry personal data. Used by the default
 * `redactPayload` to strip them from the stored webhook audit log.
 */
const DEFAULT_PII_ATTRIBUTE_KEYS: ReadonlySet<string> = new Set([
  "$email",
  "$phoneNumber",
  "$displayName",
  "$apnsTokens",
  "$fcmTokens",
  "$gpsAdId",
  "$androidIdfa",
  "$idfa",
  "$idfv",
  "$ip",
  "$firstName",
  "$lastName",
]);

export type GracePeriodStatus = GracePeriodReturn;

type QueryCtx = Pick<GenericActionCtx<GenericDataModel>, "runQuery">;
type MutCtx = Pick<GenericActionCtx<GenericDataModel>, "runMutation">;

export type EntitlementActivatedHookArgs = {
  appUserId: string;
  entitlementId: string;
  productId?: string;
  purchasedAtMs?: number;
  expiresAtMs?: number;
  store?: Store;
  ownershipType?: OwnershipType;
  isSandbox: boolean;
  // RC webhook `event.type` (e.g., "INITIAL_PURCHASE", "RENEWAL") or "SYNC"
  // when the transition was detected by `syncSubscriber`.
  sourceEventType: string;
};

export type EntitlementDeactivatedHookArgs = {
  appUserId: string;
  entitlementId: string;
  productId?: string;
  purchasedAtMs?: number;
  expiresAtMs?: number;
  store?: Store;
  ownershipType?: OwnershipType;
  isSandbox: boolean;
  sourceEventType: string;
};

export type CustomerDeletedHookArgs = {
  appUserId: string;
};

export type EntitlementActivatedHook = FunctionReference<
  "mutation" | "action",
  "public" | "internal",
  EntitlementActivatedHookArgs,
  unknown
>;

export type EntitlementDeactivatedHook = FunctionReference<
  "mutation" | "action",
  "public" | "internal",
  EntitlementDeactivatedHookArgs,
  unknown
>;

export type CustomerDeletedHook = FunctionReference<
  "mutation" | "action",
  "public" | "internal",
  CustomerDeletedHookArgs,
  unknown
>;

export type LifecycleHooks = {
  /**
   * Fires when an entitlement transitions from not-active to active for a
   * user. Triggered by webhook (INITIAL_PURCHASE, RENEWAL, REFUND_REVERSED,
   * TRANSFER onto a user, SUBSCRIBER_ALIAS) and by `syncSubscriber`.
   */
  onEntitlementActivated?: EntitlementActivatedHook;
  /**
   * Fires when an entitlement transitions from active to not-active.
   * Triggered by EXPIRATION, refund CANCELLATION, TRANSFER off a user, and
   * sync reconciliation that detects a previously-unseen revocation.
   */
  onEntitlementDeactivated?: EntitlementDeactivatedHook;
  /**
   * Fires after `deleteCustomer` purges component-local rows for a user.
   */
  onCustomerDeleted?: CustomerDeletedHook;
};

export interface RevenueCatOptions {
  /**
   * Authorization header value for webhook authentication.
   * RevenueCat sends this in the Authorization header.
   * Can be a raw value or "Bearer <token>" format.
   */
  REVENUECAT_WEBHOOK_AUTH?: string;
  /**
   * Lifecycle hooks invoked when entitlement state transitions or a customer
   * is deleted. Every hook is optional. Hooks are scheduled from inside the
   * component mutation that made the change, so scheduling is atomic with
   * the state write — a rolled-back mutation never fires its hooks.
   */
  hooks?: LifecycleHooks;
  /**
   * Optional payload-redactor run before webhook events are persisted to the
   * component's `webhookEvents` audit table. Receives the sanitized payload
   * (null keys stripped, `$` keys encoded) and returns what to store. Default:
   * strips RC-reserved PII keys (`$email`, `$phoneNumber`, etc.) from
   * `subscriber_attributes`. Pass a function to customize; pass `"off"` to
   * disable redaction (not recommended for GDPR-sensitive apps).
   */
  redactPayload?: ((payload: Record<string, unknown>) => Record<string, unknown>) | "off";
}

/**
 * Default PII redactor: removes RC's reserved personal-data attribute keys
 * from `subscriber_attributes` before storing the payload for 30-day audit.
 * Non-destructive (clones the payload), idempotent.
 */
function defaultRedactPayload(payload: Record<string, unknown>): Record<string, unknown> {
  const attrs = payload.subscriber_attributes as Record<string, unknown> | undefined;
  if (!attrs || typeof attrs !== "object") return payload;
  const redacted: Record<string, unknown> = { ...payload };
  const filteredAttrs: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(attrs)) {
    // Keys reach this layer already `__dollar__`-encoded by transformPayload;
    // match on the decoded form against the reserved set.
    const decoded = key.startsWith("__dollar__") ? `$${key.slice(10)}` : key;
    if (DEFAULT_PII_ATTRIBUTE_KEYS.has(decoded)) continue;
    filteredAttrs[key] = value;
  }
  redacted.subscriber_attributes = filteredAttrs;
  return redacted;
}

/**
 * Constant-time string comparison to prevent timing attacks.
 * Falls back to regular comparison if lengths differ (already leaks length info).
 */
function secureCompare(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

/**
 * Extract token from Authorization header.
 * Supports both "Bearer <token>" format and raw token.
 */
function extractAuthToken(header: string): string {
  const bearerPrefix = "Bearer ";
  if (header.startsWith(bearerPrefix)) {
    return header.slice(bearerPrefix.length);
  }
  return header;
}

const KNOWN_STORES: ReadonlySet<string> = new Set([
  "APP_STORE",
  "MAC_APP_STORE",
  "PLAY_STORE",
  "AMAZON",
  "STRIPE",
  "PROMOTIONAL",
  "RC_BILLING",
  "EXTERNAL",
  "PADDLE",
  "TEST_STORE",
  "GALAXY",
  "ROKU",
  "UNKNOWN_STORE",
]);

/**
 * Normalize a webhook `store` value to the form our schema expects.
 *
 * The Android SDK Store enum uses `unknown` as the wire value for the
 * `UNKNOWN_STORE` case. We map `"UNKNOWN"` to `"UNKNOWN_STORE"` and uppercase
 * anything lower-case. Values not in the known set fall back to
 * `UNKNOWN_STORE` so a future RC store addition doesn't reject the event at
 * the outer schema validator (the inner handler validators already accept
 * `v.any()` for the payload).
 */
function normalizeStore(store: unknown): string | undefined {
  if (typeof store !== "string") return undefined;
  const upper = store.toUpperCase();
  const candidate = upper === "UNKNOWN" ? "UNKNOWN_STORE" : upper;
  return KNOWN_STORES.has(candidate) ? candidate : "UNKNOWN_STORE";
}

/**
 * Convert configured entitlement hooks into FunctionHandle strings the
 * component mutations can pass directly to `ctx.scheduler.runAfter`. We use
 * handles (not `FunctionReference` objects) because Convex strips the
 * symbol-keyed markers FunctionReferences rely on when they cross a mutation
 * boundary as args.
 */
async function buildHooksArg(
  hooks: LifecycleHooks | undefined,
): Promise<
  | {
      onEntitlementActivated?: string;
      onEntitlementDeactivated?: string;
    }
  | undefined
> {
  if (!hooks) return undefined;
  const result: {
    onEntitlementActivated?: string;
    onEntitlementDeactivated?: string;
  } = {};
  if (hooks.onEntitlementActivated) {
    result.onEntitlementActivated = await createFunctionHandle(
      hooks.onEntitlementActivated,
    );
  }
  if (hooks.onEntitlementDeactivated) {
    result.onEntitlementDeactivated = await createFunctionHandle(
      hooks.onEntitlementDeactivated,
    );
  }
  if (!result.onEntitlementActivated && !result.onEntitlementDeactivated) {
    return undefined;
  }
  return result;
}

/**
 * Transform payload for Convex compatibility:
 * - Remove null object keys (v.optional expects field absence, not null)
 * - Encode $ keys (Convex rejects keys starting with $)
 */
function transformPayload(obj: unknown): unknown {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map(transformPayload);

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    if (value === null) continue;
    const safeKey = key.startsWith("$") ? `__dollar__${key.slice(1)}` : key;
    result[safeKey] = transformPayload(value);
  }
  return result;
}

export class RevenueCat {
  constructor(
    public component: ClientComponentApi,
    public options: RevenueCatOptions = {},
  ) {
    // Empty-string auth is a footgun: `if (expectedAuth)` treats `""` as
    // "no auth configured" and accepts unauthenticated requests. Consumers
    // commonly write `process.env.REVENUECAT_WEBHOOK_AUTH ?? ""`. Fail loud
    // at construction rather than silently disabling auth.
    if (options.REVENUECAT_WEBHOOK_AUTH === "") {
      throw new Error(
        "[convex-revenuecat] REVENUECAT_WEBHOOK_AUTH cannot be empty string. " +
          "Omit the field entirely to disable auth (strongly discouraged), or " +
          "provide a non-empty secret.",
      );
    }
  }

  async hasEntitlement(
    ctx: QueryCtx,
    args: { appUserId: string; entitlementId: string },
  ): Promise<boolean> {
    return ctx.runQuery(this.component.entitlements.check, args);
  }

  async getActiveEntitlements(ctx: QueryCtx, args: { appUserId: string }): Promise<Entitlement[]> {
    return ctx.runQuery(this.component.entitlements.getActive, args) as Promise<Entitlement[]>;
  }

  async getAllEntitlements(ctx: QueryCtx, args: { appUserId: string }): Promise<Entitlement[]> {
    return ctx.runQuery(this.component.entitlements.list, args) as Promise<Entitlement[]>;
  }

  async getActiveSubscriptions(
    ctx: QueryCtx,
    args: { appUserId: string },
  ): Promise<Subscription[]> {
    return ctx.runQuery(this.component.subscriptions.getActive, args) as Promise<Subscription[]>;
  }

  async getAllSubscriptions(ctx: QueryCtx, args: { appUserId: string }): Promise<Subscription[]> {
    return ctx.runQuery(this.component.subscriptions.getByUser, args) as Promise<Subscription[]>;
  }

  async getCustomer(ctx: QueryCtx, args: { appUserId: string }): Promise<Customer | null> {
    return ctx.runQuery(this.component.customers.get, args) as Promise<Customer | null>;
  }

  /**
   * Purge all component-local data for a user.
   *
   * Deletes customer, subscriptions, entitlements, experiments, invoices,
   * virtual currency balances/transactions, and webhookEvents keyed to the
   * given appUserId. Returns per-table deletion counts.
   *
   * Does NOT call RevenueCat's REST API. To also purge RevenueCat-side,
   * call `DELETE /v1/subscribers/{app_user_id}` from a Convex action
   * with a secret API key.
   */
  async deleteCustomer(
    ctx: MutCtx,
    args: { appUserId: string },
  ): Promise<DeleteCustomerResult> {
    const onCustomerDeleted = this.options.hooks?.onCustomerDeleted
      ? await createFunctionHandle(this.options.hooks.onCustomerDeleted)
      : undefined;
    return ctx.runMutation(this.component.customers.purge, {
      appUserId: args.appUserId,
      onCustomerDeleted,
    }) as Promise<DeleteCustomerResult>;
  }

  async getExperiment(
    ctx: QueryCtx,
    args: { appUserId: string; experimentId: string },
  ): Promise<Experiment | null> {
    return ctx.runQuery(this.component.experiments.get, args) as Promise<Experiment | null>;
  }

  async getExperiments(ctx: QueryCtx, args: { appUserId: string }): Promise<Experiment[]> {
    return ctx.runQuery(this.component.experiments.list, args) as Promise<Experiment[]>;
  }

  async getTransfer(ctx: QueryCtx, args: { eventId: string }): Promise<Transfer | null> {
    return ctx.runQuery(this.component.transfers.getByEventId, args) as Promise<Transfer | null>;
  }

  async getTransfers(ctx: QueryCtx, args: { limit?: number } = {}): Promise<Transfer[]> {
    return ctx.runQuery(this.component.transfers.list, args) as Promise<Transfer[]>;
  }

  async getInvoice(ctx: QueryCtx, args: { invoiceId: string }): Promise<Invoice | null> {
    return ctx.runQuery(this.component.invoices.get, args) as Promise<Invoice | null>;
  }

  async getInvoices(ctx: QueryCtx, args: { appUserId: string }): Promise<Invoice[]> {
    return ctx.runQuery(this.component.invoices.listByUser, args) as Promise<Invoice[]>;
  }

  async getVirtualCurrencyBalance(
    ctx: QueryCtx,
    args: { appUserId: string; currencyCode: string },
  ): Promise<VirtualCurrencyBalance | null> {
    return ctx.runQuery(this.component.virtualCurrency.getBalance, args) as Promise<VirtualCurrencyBalance | null>;
  }

  async getVirtualCurrencyBalances(
    ctx: QueryCtx,
    args: { appUserId: string },
  ): Promise<VirtualCurrencyBalance[]> {
    return ctx.runQuery(this.component.virtualCurrency.listBalances, args) as Promise<VirtualCurrencyBalance[]>;
  }

  async getVirtualCurrencyTransactions(
    ctx: QueryCtx,
    args: { appUserId: string; currencyCode?: string },
  ): Promise<VirtualCurrencyTransaction[]> {
    return ctx.runQuery(this.component.virtualCurrency.listTransactions, args) as Promise<VirtualCurrencyTransaction[]>;
  }

  /**
   * Check if a specific subscription is currently in a billing grace period.
   * During grace period, the user should retain access while the store retries charging.
   */
  async isInGracePeriod(
    ctx: QueryCtx,
    args: { originalTransactionId: string },
  ): Promise<GracePeriodStatus> {
    return ctx.runQuery(this.component.subscriptions.isInGracePeriod, args) as Promise<GracePeriodStatus>;
  }

  /**
   * Get all subscriptions currently in a grace period for a user.
   */
  async getSubscriptionsInGracePeriod(
    ctx: QueryCtx,
    args: { appUserId: string },
  ): Promise<Subscription[]> {
    return ctx.runQuery(this.component.subscriptions.getInGracePeriod, args) as Promise<Subscription[]>;
  }

  /**
   * Sync a subscriber's state from RevenueCat's REST API into the component.
   *
   * Pass the `subscriber` object from `GET /v1/subscribers/{app_user_id}`.
   * Upserts customer, subscriptions, and entitlements to match RevenueCat's
   * source of truth. Call from a Convex action after fetching the API.
   */
  async syncSubscriber(
    ctx: MutCtx,
    args: { appUserId: string; subscriber: RevenueCatSubscriber },
  ): Promise<SyncResult> {
    const hooks = await buildHooksArg(this.options.hooks);
    return ctx.runMutation(this.component.sync.ingest, {
      appUserId: args.appUserId,
      subscriber: transformPayload(args.subscriber) as Record<string, unknown>,
      hooks,
    }) as Promise<SyncResult>;
  }

  httpHandler() {
    const component = this.component;
    const expectedAuth = this.options.REVENUECAT_WEBHOOK_AUTH;
    const configuredHooks = this.options.hooks;
    const redactPayload =
      this.options.redactPayload === "off"
        ? undefined
        : (this.options.redactPayload ?? defaultRedactPayload);

    return httpActionGeneric(async (ctx, request) => {
      if (expectedAuth) {
        const authHeader = request.headers.get("Authorization") ?? "";
        const providedToken = extractAuthToken(authHeader);
        const expectedToken = extractAuthToken(expectedAuth);

        if (!secureCompare(providedToken, expectedToken)) {
          return new Response(JSON.stringify({ error: "Unauthorized" }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
          });
        }
      }

      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return new Response(JSON.stringify({ error: "Invalid JSON" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }

      const payload = body as { api_version?: string; event?: Record<string, unknown> };
      const event = payload.event;

      if (!event || typeof event.id !== "string" || typeof event.type !== "string") {
        return new Response(JSON.stringify({ error: "Invalid webhook payload" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }

      // Reject oversized event IDs at the HTTP boundary so we don't waste a
      // mutation round-trip to bounce them. Matches the component-side cap.
      if (event.id.length > 128) {
        return new Response(JSON.stringify({ error: "Event ID too long" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }

      let sanitizedEvent = transformPayload(event) as Record<string, unknown>;
      if (redactPayload) {
        sanitizedEvent = redactPayload(sanitizedEvent);
      }
      const normalizedStore = normalizeStore(event.store) as Store | undefined;
      if (normalizedStore && normalizedStore !== event.store) {
        // Keep the payload consistent with the outer event object so inner
        // handlers see the normalized form if they inspect `event.store`.
        sanitizedEvent.store = normalizedStore;
      }

      const hooksArg = await buildHooksArg(configuredHooks);

      try {
        const result = await ctx.runMutation(component.webhooks.process, {
          event: {
            id: event.id as string,
            type: event.type as string,
            app_id: event.app_id as string | undefined,
            app_user_id: event.app_user_id as string | undefined,
            environment: (event.environment as Environment) ?? "PRODUCTION",
            store: normalizedStore,
          },
          payload: sanitizedEvent,
          hooks: hooksArg,
        });

        return new Response(JSON.stringify(result), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      } catch (error) {
        if (error && typeof error === "object" && "data" in error) {
          const convexError = error as { data?: { code?: string; data?: { resetAt?: number } } };
          if (convexError.data?.code === "RATE_LIMITED") {
            const resetAt = convexError.data?.data?.resetAt;
            return new Response(JSON.stringify({ error: "Rate limit exceeded", resetAt }), {
              status: 429,
              headers: {
                "Content-Type": "application/json",
                ...(resetAt
                  ? { "Retry-After": String(Math.ceil((resetAt - Date.now()) / 1000)) }
                  : {}),
              },
            });
          }
          if (convexError.data?.code === "INVALID_ARGUMENT") {
            return new Response(JSON.stringify({ error: "Invalid webhook payload" }), {
              status: 400,
              headers: { "Content-Type": "application/json" },
            });
          }
        }
        throw error;
      }
    });
  }
}
