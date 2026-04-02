import { httpActionGeneric } from "convex/server";
import type { GenericActionCtx, GenericDataModel, FunctionReference } from "convex/server";

// Convex generates component types with "internal" visibility in consumer apps
// regardless of how they're defined in the component. Define the expected API
// shape directly to avoid visibility mismatches.
type AnyVisibility = "public" | "internal";

type ClientComponentApi = {
  entitlements: {
    check: FunctionReference<"query", AnyVisibility, { appUserId: string; entitlementId: string }, boolean>;
    getActive: FunctionReference<"query", AnyVisibility, { appUserId: string }, any[]>;
    list: FunctionReference<"query", AnyVisibility, { appUserId: string }, any[]>;
  };
  subscriptions: {
    getActive: FunctionReference<"query", AnyVisibility, { appUserId: string }, any[]>;
    getByUser: FunctionReference<"query", AnyVisibility, { appUserId: string }, any[]>;
    isInGracePeriod: FunctionReference<"query", AnyVisibility, { originalTransactionId: string }, { inGracePeriod: boolean; gracePeriodExpiresAt?: number; billingIssueDetectedAt?: number }>;
    getInGracePeriod: FunctionReference<"query", AnyVisibility, { appUserId: string }, any[]>;
  };
  customers: {
    get: FunctionReference<"query", AnyVisibility, { appUserId: string }, any>;
  };
  experiments: {
    get: FunctionReference<"query", AnyVisibility, { appUserId: string; experimentId: string }, any>;
    list: FunctionReference<"query", AnyVisibility, { appUserId: string }, any[]>;
  };
  transfers: {
    getByEventId: FunctionReference<"query", AnyVisibility, { eventId: string }, any>;
    list: FunctionReference<"query", AnyVisibility, { limit?: number }, any[]>;
  };
  invoices: {
    get: FunctionReference<"query", AnyVisibility, { invoiceId: string }, any>;
    listByUser: FunctionReference<"query", AnyVisibility, { appUserId: string }, any[]>;
  };
  virtualCurrency: {
    getBalance: FunctionReference<"query", AnyVisibility, { appUserId: string; currencyCode: string }, any>;
    listBalances: FunctionReference<"query", AnyVisibility, { appUserId: string }, any[]>;
    listTransactions: FunctionReference<"query", AnyVisibility, { appUserId: string; currencyCode?: string }, any[]>;
  };
  webhooks: {
    process: FunctionReference<"mutation", AnyVisibility, { event: any; payload: any }, { processed: boolean; eventId: string }>;
  };
  sync: {
    ingest: FunctionReference<"mutation", AnyVisibility, { appUserId: string; subscriber: { entitlements?: any; subscriptions?: any; subscriber_attributes?: any; first_seen?: string; last_seen?: string; original_app_user_id?: string } }, { subscriptions: number; entitlements: number }>;
  };
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
};

import type {
  Store,
  Environment,
  Entitlement,
  Subscription,
  Customer,
  Experiment,
  Transfer,
  Invoice,
  VirtualCurrencyBalance,
  VirtualCurrencyTransaction,
} from "../component/types.js";

export type GracePeriodStatus = {
  inGracePeriod: boolean;
  gracePeriodExpiresAt?: number;
  billingIssueDetectedAt?: number;
};

type QueryCtx = Pick<GenericActionCtx<GenericDataModel>, "runQuery">;
type MutCtx = Pick<GenericActionCtx<GenericDataModel>, "runMutation">;

export interface RevenueCatOptions {
  /**
   * Authorization header value for webhook authentication.
   * RevenueCat sends this in the Authorization header.
   * Can be a raw value or "Bearer <token>" format.
   */
  REVENUECAT_WEBHOOK_AUTH?: string;
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
  ) {}

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
    return ctx.runMutation(this.component.sync.ingest, {
      appUserId: args.appUserId,
      subscriber: transformPayload(args.subscriber) as Record<string, unknown>,
    }) as Promise<SyncResult>;
  }

  httpHandler() {
    const component = this.component;
    const expectedAuth = this.options.REVENUECAT_WEBHOOK_AUTH;

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

      const sanitizedEvent = transformPayload(event) as Record<string, unknown>;

      try {
        const result = await ctx.runMutation(component.webhooks.process, {
          event: {
            id: event.id as string,
            type: event.type as string,
            app_id: event.app_id as string | undefined,
            app_user_id: event.app_user_id as string | undefined,
            environment: (event.environment as Environment) ?? "PRODUCTION",
            store: event.store as Store | undefined,
          },
          payload: sanitizedEvent,
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
