import { httpActionGeneric } from "convex/server";
import type { GenericActionCtx, GenericDataModel } from "convex/server";
import type { ComponentApi } from "../component/_generated/component.js";

type QueryCtx = Pick<GenericActionCtx<GenericDataModel>, "runQuery">;
type MutationCtx = Pick<GenericActionCtx<GenericDataModel>, "runMutation">;

export interface RevenueCatOptions {
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
  // Mutations - for manual entitlement management (local database only)
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Grant an entitlement to a user (local database only)
   *
   * Use for testing or manual overrides. For production promotional
   * entitlements, call the RevenueCat API directly and let webhooks sync.
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
   *
   * Use for testing or manual overrides. For production, revoke via
   * the RevenueCat API and let webhooks sync.
   */
  async revokeEntitlement(
    ctx: MutationCtx,
    args: { appUserId: string; entitlementId: string },
  ): Promise<boolean> {
    return await ctx.runMutation(this.component.entitlements.revoke, args);
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
