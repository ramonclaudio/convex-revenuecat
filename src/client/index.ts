import { httpActionGeneric } from "convex/server";
import type { GenericActionCtx, GenericDataModel } from "convex/server";
import type { ComponentApi } from "../component/_generated/component.js";

export type {
  Store,
  Environment,
  PeriodType,
  Entitlement,
  Subscription,
  Customer,
  WebhookEvent,
  WebhookEventStatus,
} from "../component/types.js";

import type {
  Store,
  Environment,
  Entitlement,
  Subscription,
  Customer,
  WebhookEvent,
} from "../component/types.js";

type QueryCtx = Pick<GenericActionCtx<GenericDataModel>, "runQuery">;

export interface RevenueCatOptions {
  REVENUECAT_WEBHOOK_AUTH?: string;
}

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

  async getWebhookEvent(ctx: QueryCtx, args: { eventId: string }): Promise<WebhookEvent | null> {
    return ctx.runQuery(
      this.component.webhookEvents.getByEventId,
      args,
    ) as Promise<WebhookEvent | null>;
  }

  async getWebhookEventsByUser(
    ctx: QueryCtx,
    args: { appUserId: string; limit?: number },
  ): Promise<WebhookEvent[]> {
    return ctx.runQuery(this.component.webhookEvents.listByUser, args) as Promise<WebhookEvent[]>;
  }

  async getFailedWebhookEvents(
    ctx: QueryCtx,
    args: { limit?: number } = {},
  ): Promise<WebhookEvent[]> {
    return ctx.runQuery(this.component.webhookEvents.listFailed, args) as Promise<WebhookEvent[]>;
  }

  httpHandler() {
    const component = this.component;
    const expectedAuth = this.options.REVENUECAT_WEBHOOK_AUTH;

    return httpActionGeneric(async (ctx, request) => {
      if (expectedAuth) {
        const authHeader = request.headers.get("Authorization");
        if (authHeader !== expectedAuth) {
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

      const encodedEvent = encodeReservedKeys(event) as Record<string, unknown>;

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
          payload: encodedEvent,
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
