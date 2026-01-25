import { httpActionGeneric } from "convex/server";
import type { GenericActionCtx, GenericDataModel } from "convex/server";
import type { ComponentApi } from "../component/_generated/component.js";

type QueryCtx = Pick<GenericActionCtx<GenericDataModel>, "runQuery">;
type MutationCtx = Pick<GenericActionCtx<GenericDataModel>, "runMutation">;
type ActionCtx = Pick<GenericActionCtx<GenericDataModel>, "runQuery" | "runMutation" | "runAction">;

export interface RevenueCatOptions {
  /**
   * RevenueCat secret API key - used for all API calls
   * Get from: RevenueCat Dashboard → Project Settings → API Keys
   *
   * Note: This key works with both v1 (promotional) and v2 (customer data) endpoints.
   * The component automatically uses the correct API version for each operation.
   */
  REVENUECAT_API_KEY?: string;

  /**
   * RevenueCat Project ID - required for v2 API calls (getCustomerFromApi)
   * Find in: RevenueCat Dashboard → Project Settings
   */
  REVENUECAT_PROJECT_ID?: string;

  /**
   * Webhook authorization header value for verifying incoming webhooks
   * Set in: RevenueCat Dashboard → Integrations → Webhooks → Authorization header
   */
  REVENUECAT_WEBHOOK_AUTH?: string;
}

// Re-export types for consumers
export type Store =
  | "AMAZON"
  | "APP_STORE"
  | "MAC_APP_STORE"
  | "PADDLE"
  | "PLAY_STORE"
  | "PROMOTIONAL"
  | "RC_BILLING"
  | "ROKU"
  | "STRIPE"
  | "TEST_STORE";

export type Environment = "SANDBOX" | "PRODUCTION";

export type PeriodType = "TRIAL" | "INTRO" | "NORMAL" | "PROMOTIONAL" | "PREPAID";

export interface Entitlement {
  _id: string;
  _creationTime: number;
  appUserId: string;
  entitlementId: string;
  productId?: string;
  isActive: boolean;
  expiresAtMs?: number;
  purchasedAtMs?: number;
  store?: Store;
  isSandbox: boolean;
  unsubscribeDetectedAt?: number;
  billingIssueDetectedAt?: number;
  updatedAt: number;
}

export interface Subscription {
  _id: string;
  _creationTime: number;
  appUserId: string;
  productId: string;
  entitlementIds?: string[];
  store: Store;
  environment: Environment;
  periodType: PeriodType;
  purchasedAtMs: number;
  expirationAtMs?: number;
  originalTransactionId: string;
  transactionId: string;
  isFamilyShare: boolean;
  isTrialConversion?: boolean;
  autoRenewStatus?: boolean;
  cancelReason?: string;
  expirationReason?: string;
  gracePeriodExpirationAtMs?: number;
  billingIssueDetectedAt?: number;
  autoResumeAtMs?: number;
  priceUsd?: number;
  currency?: string;
  priceInPurchasedCurrency?: number;
  countryCode?: string;
  taxPercentage?: number;
  commissionPercentage?: number;
  offerCode?: string;
  presentedOfferingId?: string;
  renewalNumber?: number;
  newProductId?: string;
  updatedAt: number;
}

export interface Customer {
  _id: string;
  _creationTime: number;
  appUserId: string;
  originalAppUserId: string;
  aliases: string[];
  firstSeenAt: number;
  lastSeenAt?: number;
  attributes?: unknown;
  updatedAt: number;
}

// Helper: Recursively encode $ prefixed keys in objects
// Convex doesn't allow $ prefix in object keys, but RevenueCat uses them for subscriber_attributes
function encodeReservedKeys(obj: unknown): unknown {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map(encodeReservedKeys);

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    const encodedKey = key.startsWith("$") ? `__dollar__${key.slice(1)}` : key;
    result[encodedKey] = encodeReservedKeys(value);
  }
  return result;
}

export class RevenueCat {
  constructor(
    public component: ComponentApi,
    public options: RevenueCatOptions = {},
  ) {}

  // ─────────────────────────────────────────────────────────────────────────────
  // Queries - for use in queries, mutations, and actions
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Check if a user has an active entitlement
   */
  async hasEntitlement(
    ctx: QueryCtx,
    args: { appUserId: string; entitlementId: string },
  ): Promise<boolean> {
    return await ctx.runQuery(this.component.entitlements.check, args);
  }

  /**
   * Get all active entitlements for a user
   */
  async getActiveEntitlements(ctx: QueryCtx, args: { appUserId: string }): Promise<Entitlement[]> {
    return (await ctx.runQuery(this.component.entitlements.getActive, args)) as Entitlement[];
  }

  /**
   * Get all entitlements for a user (active and inactive)
   */
  async getAllEntitlements(ctx: QueryCtx, args: { appUserId: string }): Promise<Entitlement[]> {
    return (await ctx.runQuery(this.component.entitlements.list, args)) as Entitlement[];
  }

  /**
   * Get all active subscriptions for a user
   */
  async getActiveSubscriptions(
    ctx: QueryCtx,
    args: { appUserId: string },
  ): Promise<Subscription[]> {
    return (await ctx.runQuery(this.component.subscriptions.getActive, args)) as Subscription[];
  }

  /**
   * Get all subscriptions for a user (active and expired)
   */
  async getAllSubscriptions(ctx: QueryCtx, args: { appUserId: string }): Promise<Subscription[]> {
    return (await ctx.runQuery(this.component.subscriptions.getByUser, args)) as Subscription[];
  }

  /**
   * Get customer by app user ID
   */
  async getCustomer(ctx: QueryCtx, args: { appUserId: string }): Promise<Customer | null> {
    return (await ctx.runQuery(this.component.customers.get, args)) as Customer | null;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Mutations - for manual entitlement management
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Grant an entitlement to a user (local database only)
   * Use grantEntitlementViaApi() to sync with RevenueCat
   */
  async grantEntitlement(
    ctx: MutationCtx,
    args: {
      appUserId: string;
      entitlementId: string;
      productId?: string;
      expiresAtMs?: number;
      isSandbox?: boolean;
    },
  ): Promise<string> {
    return await ctx.runMutation(this.component.entitlements.grant, {
      appUserId: args.appUserId,
      entitlementId: args.entitlementId,
      productId: args.productId,
      expiresAtMs: args.expiresAtMs,
      isSandbox: args.isSandbox ?? false,
    });
  }

  /**
   * Revoke an entitlement from a user (local database only)
   * Use revokeEntitlementViaApi() to sync with RevenueCat
   */
  async revokeEntitlement(
    ctx: MutationCtx,
    args: { appUserId: string; entitlementId: string },
  ): Promise<boolean> {
    return await ctx.runMutation(this.component.entitlements.revoke, args);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Actions - for RevenueCat API integration
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Grant a promotional entitlement via RevenueCat API
   *
   * Uses the v1 API endpoint (v2 does not support promotional entitlements).
   * Requires REVENUECAT_API_KEY.
   *
   * @see https://www.revenuecat.com/docs/api-v1#tag/entitlements/operation/grant-a-promotional-entitlement
   */
  async grantEntitlementViaApi(
    ctx: ActionCtx,
    args: {
      appUserId: string;
      entitlementId: string;
      duration?:
        | "daily"
        | "three_day"
        | "weekly"
        | "monthly"
        | "two_month"
        | "three_month"
        | "six_month"
        | "yearly"
        | "lifetime";
    },
  ): Promise<unknown> {
    const { REVENUECAT_API_KEY } = this.options;
    if (!REVENUECAT_API_KEY) {
      throw new Error(
        "REVENUECAT_API_KEY is required for API calls. " +
          "Get it from: RevenueCat Dashboard → Project Settings → API Keys.",
      );
    }

    return await ctx.runAction(this.component.api.grantEntitlement, {
      apiKey: REVENUECAT_API_KEY,
      appUserId: args.appUserId,
      entitlementId: args.entitlementId,
      duration: args.duration ?? "lifetime",
    });
  }

  /**
   * Revoke a promotional entitlement via RevenueCat API
   *
   * Uses the v1 API endpoint (v2 does not support promotional entitlements).
   * Requires REVENUECAT_API_KEY.
   *
   * @see https://www.revenuecat.com/docs/api-v1#tag/entitlements/operation/revoke-promotional-entitlements
   */
  async revokeEntitlementViaApi(
    ctx: ActionCtx,
    args: { appUserId: string; entitlementId: string },
  ): Promise<unknown> {
    const { REVENUECAT_API_KEY } = this.options;
    if (!REVENUECAT_API_KEY) {
      throw new Error(
        "REVENUECAT_API_KEY is required for API calls. " +
          "Get it from: RevenueCat Dashboard → Project Settings → API Keys.",
      );
    }

    return await ctx.runAction(this.component.api.revokeEntitlement, {
      apiKey: REVENUECAT_API_KEY,
      appUserId: args.appUserId,
      entitlementId: args.entitlementId,
    });
  }

  /**
   * Get customer info from RevenueCat API
   *
   * Uses the v2 API endpoint.
   * Requires REVENUECAT_API_KEY and REVENUECAT_PROJECT_ID.
   */
  async getCustomerFromApi(ctx: ActionCtx, args: { appUserId: string }): Promise<unknown> {
    const { REVENUECAT_API_KEY, REVENUECAT_PROJECT_ID } = this.options;
    if (!REVENUECAT_API_KEY) {
      throw new Error(
        "REVENUECAT_API_KEY is required for API calls. " +
          "Get it from: RevenueCat Dashboard → Project Settings → API Keys.",
      );
    }
    if (!REVENUECAT_PROJECT_ID) {
      throw new Error(
        "REVENUECAT_PROJECT_ID is required for getCustomerFromApi. " +
          "Find it in: RevenueCat Dashboard → Project Settings.",
      );
    }

    return await ctx.runAction(this.component.api.getCustomer, {
      apiKey: REVENUECAT_API_KEY,
      projectId: REVENUECAT_PROJECT_ID,
      appUserId: args.appUserId,
    });
  }

  /**
   * Delete a customer from RevenueCat (GDPR compliance)
   *
   * WARNING: This permanently deletes the customer and all their data.
   * This action cannot be undone.
   *
   * Requires REVENUECAT_API_KEY.
   */
  async deleteCustomerViaApi(
    ctx: ActionCtx,
    args: { appUserId: string },
  ): Promise<{ deleted: boolean; app_user_id: string }> {
    const { REVENUECAT_API_KEY } = this.options;
    if (!REVENUECAT_API_KEY) {
      throw new Error(
        "REVENUECAT_API_KEY is required for API calls. " +
          "Get it from: RevenueCat Dashboard → Project Settings → API Keys.",
      );
    }

    return await ctx.runAction(this.component.api.deleteCustomer, {
      apiKey: REVENUECAT_API_KEY,
      appUserId: args.appUserId,
    });
  }

  /**
   * Update customer attributes via RevenueCat API
   *
   * Attribute keys starting with $ are reserved (e.g., $email, $displayName).
   * Custom attribute keys must not start with $.
   *
   * Requires REVENUECAT_API_KEY.
   */
  async updateAttributesViaApi(
    ctx: ActionCtx,
    args: {
      appUserId: string;
      attributes: Record<string, { value: string | null; updated_at_ms?: number }>;
    },
  ): Promise<{ success: boolean }> {
    const { REVENUECAT_API_KEY } = this.options;
    if (!REVENUECAT_API_KEY) {
      throw new Error(
        "REVENUECAT_API_KEY is required for API calls. " +
          "Get it from: RevenueCat Dashboard → Project Settings → API Keys.",
      );
    }

    return await ctx.runAction(this.component.api.updateAttributes, {
      apiKey: REVENUECAT_API_KEY,
      appUserId: args.appUserId,
      attributes: args.attributes,
    });
  }

  /**
   * Get offerings for a customer via RevenueCat API
   *
   * Useful for server-rendered paywalls or backend offering logic.
   * Requires REVENUECAT_API_KEY.
   */
  async getOfferingsViaApi(
    ctx: ActionCtx,
    args: {
      appUserId: string;
      platform?: "ios" | "android" | "amazon" | "macos" | "uikitformac";
    },
  ): Promise<unknown> {
    const { REVENUECAT_API_KEY } = this.options;
    if (!REVENUECAT_API_KEY) {
      throw new Error(
        "REVENUECAT_API_KEY is required for API calls. " +
          "Get it from: RevenueCat Dashboard → Project Settings → API Keys.",
      );
    }

    return await ctx.runAction(this.component.api.getOfferings, {
      apiKey: REVENUECAT_API_KEY,
      appUserId: args.appUserId,
      platform: args.platform,
    });
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // HTTP Handler - for webhook processing
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Create an HTTP action handler for RevenueCat webhooks
   * Mount this in your convex/http.ts file
   */
  httpHandler() {
    const component = this.component;
    const expectedAuth = this.options.REVENUECAT_WEBHOOK_AUTH;

    return httpActionGeneric(async (ctx, request) => {
      // Verify authorization if configured
      if (expectedAuth) {
        const authHeader = request.headers.get("Authorization");
        if (authHeader !== expectedAuth) {
          return new Response(JSON.stringify({ error: "Unauthorized" }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
          });
        }
      }

      // Parse the webhook payload
      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return new Response(JSON.stringify({ error: "Invalid JSON" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }

      // Extract event from RevenueCat webhook format
      const payload = body as { api_version?: string; event?: Record<string, unknown> };
      const event = payload.event;

      if (!event || typeof event.id !== "string" || typeof event.type !== "string") {
        return new Response(JSON.stringify({ error: "Invalid webhook payload" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }

      // Process the webhook
      // Encode $ prefixed keys (like $email in subscriber_attributes) for Convex compatibility
      const encodedEvent = encodeReservedKeys(event) as Record<string, unknown>;
      const result = await ctx.runMutation(component.webhooks.process, {
        event: {
          id: event.id as string,
          type: event.type as string,
          app_id: event.app_id as string | undefined,
          app_user_id: event.app_user_id as string | undefined,
          environment: (event.environment as Environment) ?? "PRODUCTION",
          store: event.store as Store | undefined,
        },
        payload: encodedEvent,
      });

      return new Response(JSON.stringify(result), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
  }
}
