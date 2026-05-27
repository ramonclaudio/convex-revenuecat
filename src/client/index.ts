import {
  createFunctionHandle,
  httpActionGeneric,
  queryGeneric,
} from "convex/server";
import type {
  GenericActionCtx,
  GenericDataModel,
  FunctionReference,
  HttpRouter,
} from "convex/server";
import { v } from "convex/values";
import type { ComponentApi } from "../component/_generated/component.js";
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

type GracePeriodReturn = {
  inGracePeriod: boolean;
  gracePeriodExpiresAt?: number;
  billingIssueDetectedAt?: number;
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

export type RevenueCatSubscriber = {
  entitlements?: Record<
    string,
    {
      product_identifier?: string;
      expires_date?: string | null;
      grace_period_expires_date?: string | null;
      purchase_date?: string;
    }
  >;
  first_seen?: string;
  last_seen?: string;
  management_url?: string | null;
  original_app_user_id?: string;
  subscriber_attributes?: Record<
    string,
    { value: string; updated_at_ms: number }
  >;
  subscriptions?: Record<
    string,
    {
      store: string;
      is_sandbox: boolean;
      period_type: string;
      expires_date?: string | null;
      purchase_date?: string;
      original_purchase_date?: string;
      store_transaction_id?: string;
      ownership_type?: string;
      billing_issues_detected_at?: string | null;
      grace_period_expires_date?: string | null;
      auto_resume_date?: string | null;
      unsubscribe_detected_at?: string | null;
      refunded_at?: string | null;
      price?: { amount: number | string; currency: string } | null;
    }
  >;
  non_subscriptions?: Record<
    string,
    Array<{
      id: string;
      is_sandbox?: boolean;
      purchase_date?: string;
      original_purchase_date?: string;
      store?: string;
      store_transaction_id?: string;
      price?: { amount: number | string; currency: string };
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

const DEFAULT_PII_ATTRIBUTE_KEYS: ReadonlySet<string> = new Set([
  "$email",
  "$phoneNumber",
  "$displayName",
  "$ip",
  "$apnsTokens",
  "$fcmTokens",
  "$idfa",
  "$idfv",
  "$gpsAdId",
  "$amazonAdId",
  "$deviceVersion",
  "$attConsentStatus",
  "$adjustId",
  "$appsflyerId",
  "$appstackId",
  "$fbAnonId",
  "$mparticleId",
  "$onesignalId",
  "$onesignalUserId",
  "$airshipChannelId",
  "$clevertapId",
  "$airbridgeDeviceId",
  "$kochavaDeviceId",
  "$mixpanelDistinctId",
  "$firebaseAppInstanceId",
  "$tenjinId",
  "$posthogUserId",
  "$amplitudeUserId",
  "$amplitudeDeviceId",
  "$solarEngineDistinctId",
  "$solarEngineAccountId",
  "$solarEngineVisitorId",
]);

export type GracePeriodStatus = GracePeriodReturn;

type QueryCtx = Pick<GenericActionCtx<GenericDataModel>, "runQuery">;
type MutCtx = Pick<GenericActionCtx<GenericDataModel>, "runMutation">;
type AuthCtx = {
  auth: { getUserIdentity: () => Promise<{ subject: string } | null> };
};

export type EntitlementActivatedHookArgs = {
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
  onEntitlementActivated?: EntitlementActivatedHook;
  onEntitlementDeactivated?: EntitlementDeactivatedHook;
  onCustomerDeleted?: CustomerDeletedHook;
};

export interface RevenueCatOptions {
  REVENUECAT_WEBHOOK_AUTH?: string;
  hooks?: LifecycleHooks;
  redactPayload?:
    | ((payload: Record<string, unknown>) => Record<string, unknown>)
    | "off";
  getAppUserId?: (ctx: AuthCtx) => Promise<string> | string;
}

function defaultRedactPayload(
  payload: Record<string, unknown>,
): Record<string, unknown> {
  const attrs = payload.subscriber_attributes as
    | Record<string, unknown>
    | undefined;
  if (!attrs || typeof attrs !== "object") return payload;
  const redacted: Record<string, unknown> = { ...payload };
  const filteredAttrs: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(attrs)) {
    const decoded = key.startsWith("__dollar__") ? `$${key.slice(10)}` : key;
    if (DEFAULT_PII_ATTRIBUTE_KEYS.has(decoded)) continue;
    filteredAttrs[key] = value;
  }
  redacted.subscriber_attributes = filteredAttrs;
  return redacted;
}

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

function extractAuthToken(header: string): string {
  const bearerPrefix = "Bearer ";
  if (header.startsWith(bearerPrefix)) {
    return header.slice(bearerPrefix.length);
  }
  return header;
}

const MIN_AUTH_SECRET_LENGTH = 32;
const MAX_WEBHOOK_BODY_BYTES = 1_048_576;
const PURGE_MAX_PASSES = 10_000;

function validateAuthSecret(value: string): void {
  const stripped = extractAuthToken(value).trim();
  if (stripped.length === 0) {
    throw new Error(
      "[convex-revenuecat] REVENUECAT_WEBHOOK_AUTH is empty after stripping " +
        'any "Bearer " prefix and whitespace. Generate a secret with ' +
        "`openssl rand -base64 32` (~44 chars).",
    );
  }
  if (stripped.length < MIN_AUTH_SECRET_LENGTH) {
    throw new Error(
      `[convex-revenuecat] REVENUECAT_WEBHOOK_AUTH is ${stripped.length} chars ` +
        `after stripping (minimum ${MIN_AUTH_SECRET_LENGTH}). RC doesn't sign ` +
        "payloads, so the secret is the entire security boundary. Generate one " +
        "with `openssl rand -base64 32` (~44 chars).",
    );
  }
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

function normalizeStore(store: unknown): string | undefined {
  if (typeof store !== "string") return undefined;
  const upper = store.toUpperCase();
  const candidate = upper === "UNKNOWN" ? "UNKNOWN_STORE" : upper;
  return KNOWN_STORES.has(candidate) ? candidate : "UNKNOWN_STORE";
}

async function buildHooksArg(hooks: LifecycleHooks | undefined): Promise<
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
    public component: ComponentApi,
    public options: RevenueCatOptions = {},
  ) {
    if (options.REVENUECAT_WEBHOOK_AUTH !== undefined) {
      validateAuthSecret(options.REVENUECAT_WEBHOOK_AUTH);
    }
  }

  async hasEntitlement(
    ctx: QueryCtx,
    args: { appUserId: string; entitlementId: string },
  ): Promise<boolean> {
    return ctx.runQuery(this.component.entitlements.check, args);
  }

  async getActiveEntitlements(
    ctx: QueryCtx,
    args: { appUserId: string },
  ): Promise<Entitlement[]> {
    return ctx.runQuery(this.component.entitlements.getActive, args) as Promise<
      Entitlement[]
    >;
  }

  async getAllEntitlements(
    ctx: QueryCtx,
    args: { appUserId: string },
  ): Promise<Entitlement[]> {
    return ctx.runQuery(this.component.entitlements.list, args) as Promise<
      Entitlement[]
    >;
  }

  async getActiveSubscriptions(
    ctx: QueryCtx,
    args: { appUserId: string },
  ): Promise<Subscription[]> {
    return ctx.runQuery(
      this.component.subscriptions.getActive,
      args,
    ) as Promise<Subscription[]>;
  }

  async getConsumables(
    ctx: QueryCtx,
    args: { appUserId: string },
  ): Promise<Subscription[]> {
    return ctx.runQuery(
      this.component.subscriptions.getConsumables,
      args,
    ) as Promise<Subscription[]>;
  }

  async getAllSubscriptions(
    ctx: QueryCtx,
    args: { appUserId: string },
  ): Promise<Subscription[]> {
    return ctx.runQuery(
      this.component.subscriptions.getByUser,
      args,
    ) as Promise<Subscription[]>;
  }

  async getCustomer(
    ctx: QueryCtx,
    args: { appUserId: string },
  ): Promise<Customer | null> {
    return ctx.runQuery(
      this.component.customers.get,
      args,
    ) as Promise<Customer | null>;
  }

  async deleteCustomer(
    ctx: MutCtx,
    args: { appUserId: string },
  ): Promise<DeleteCustomerResult> {
    const onCustomerDeleted = this.options.hooks?.onCustomerDeleted
      ? await createFunctionHandle(this.options.hooks.onCustomerDeleted)
      : undefined;
    const total: DeleteCustomerResult = {
      customer: 0,
      subscriptions: 0,
      entitlements: 0,
      experiments: 0,
      invoices: 0,
      virtualCurrencyBalances: 0,
      virtualCurrencyTransactions: 0,
      webhookEvents: 0,
      transfers: 0,
    };
    for (let pass = 0; pass < PURGE_MAX_PASSES; pass++) {
      const { done, ...counts } = (await ctx.runMutation(
        this.component.customers.purge,
        { appUserId: args.appUserId, onCustomerDeleted },
      )) as DeleteCustomerResult & { done: boolean };
      for (const key of Object.keys(total) as (keyof DeleteCustomerResult)[]) {
        total[key] += counts[key];
      }
      if (done) return total;
    }
    throw new Error(
      "[convex-revenuecat] deleteCustomer exceeded max purge passes",
    );
  }

  async getExperiment(
    ctx: QueryCtx,
    args: { appUserId: string; experimentId: string },
  ): Promise<Experiment | null> {
    return ctx.runQuery(
      this.component.experiments.get,
      args,
    ) as Promise<Experiment | null>;
  }

  async getExperiments(
    ctx: QueryCtx,
    args: { appUserId: string },
  ): Promise<Experiment[]> {
    return ctx.runQuery(this.component.experiments.list, args) as Promise<
      Experiment[]
    >;
  }

  async getTransfer(
    ctx: QueryCtx,
    args: { eventId: string },
  ): Promise<Transfer | null> {
    return ctx.runQuery(
      this.component.transfers.getByEventId,
      args,
    ) as Promise<Transfer | null>;
  }

  async getTransfers(
    ctx: QueryCtx,
    args: { limit?: number } = {},
  ): Promise<Transfer[]> {
    return ctx.runQuery(this.component.transfers.list, args) as Promise<
      Transfer[]
    >;
  }

  async getInvoice(
    ctx: QueryCtx,
    args: { invoiceId: string },
  ): Promise<Invoice | null> {
    return ctx.runQuery(
      this.component.invoices.get,
      args,
    ) as Promise<Invoice | null>;
  }

  async getInvoices(
    ctx: QueryCtx,
    args: { appUserId: string },
  ): Promise<Invoice[]> {
    return ctx.runQuery(this.component.invoices.listByUser, args) as Promise<
      Invoice[]
    >;
  }

  async getVirtualCurrencyBalance(
    ctx: QueryCtx,
    args: { appUserId: string; currencyCode: string },
  ): Promise<VirtualCurrencyBalance | null> {
    return ctx.runQuery(
      this.component.virtualCurrency.getBalance,
      args,
    ) as Promise<VirtualCurrencyBalance | null>;
  }

  async getVirtualCurrencyBalances(
    ctx: QueryCtx,
    args: { appUserId: string },
  ): Promise<VirtualCurrencyBalance[]> {
    return ctx.runQuery(
      this.component.virtualCurrency.listBalances,
      args,
    ) as Promise<VirtualCurrencyBalance[]>;
  }

  async getVirtualCurrencyTransactions(
    ctx: QueryCtx,
    args: { appUserId: string; currencyCode?: string },
  ): Promise<VirtualCurrencyTransaction[]> {
    return ctx.runQuery(
      this.component.virtualCurrency.listTransactions,
      args,
    ) as Promise<VirtualCurrencyTransaction[]>;
  }

  async isInGracePeriod(
    ctx: QueryCtx,
    args: { originalTransactionId: string },
  ): Promise<GracePeriodStatus> {
    return ctx.runQuery(
      this.component.subscriptions.isInGracePeriod,
      args,
    ) as Promise<GracePeriodStatus>;
  }

  async getSubscriptionsInGracePeriod(
    ctx: QueryCtx,
    args: { appUserId: string },
  ): Promise<Subscription[]> {
    return ctx.runQuery(
      this.component.subscriptions.getInGracePeriod,
      args,
    ) as Promise<Subscription[]>;
  }

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

  async getEntitlement(
    ctx: QueryCtx,
    args: { appUserId: string; entitlementId: string },
  ): Promise<Entitlement | null> {
    const entitlements = (await ctx.runQuery(
      this.component.entitlements.getActive,
      { appUserId: args.appUserId },
    )) as Entitlement[];
    return (
      entitlements.find((e) => e.entitlementId === args.entitlementId) ?? null
    );
  }

  async hasAnyEntitlement(
    ctx: QueryCtx,
    args: { appUserId: string },
  ): Promise<boolean> {
    const entitlements = (await ctx.runQuery(
      this.component.entitlements.getActive,
      { appUserId: args.appUserId },
    )) as Entitlement[];
    return entitlements.length > 0;
  }

  async isSubscriber(
    ctx: QueryCtx,
    args: { appUserId: string },
  ): Promise<boolean> {
    const subs = (await ctx.runQuery(this.component.subscriptions.getActive, {
      appUserId: args.appUserId,
    })) as Subscription[];
    return subs.length > 0;
  }

  async isInTrial(
    ctx: QueryCtx,
    args: { appUserId: string },
  ): Promise<boolean> {
    const subs = (await ctx.runQuery(this.component.subscriptions.getActive, {
      appUserId: args.appUserId,
    })) as Subscription[];
    return subs.some(
      (s) => s.periodType === "TRIAL" || s.periodType === "INTRO",
    );
  }

  async wasInTrialEver(
    ctx: QueryCtx,
    args: { appUserId: string },
  ): Promise<boolean> {
    const subs = (await ctx.runQuery(this.component.subscriptions.getByUser, {
      appUserId: args.appUserId,
    })) as Subscription[];
    return subs.some(
      (s) =>
        s.periodType === "TRIAL" ||
        s.periodType === "INTRO" ||
        s.isTrialConversion === true,
    );
  }

  async getRenewsAtMs(
    ctx: QueryCtx,
    args: { appUserId: string; entitlementId: string },
  ): Promise<number | null> {
    const [entitlement, subs] = await Promise.all([
      this.getEntitlement(ctx, args),
      ctx.runQuery(this.component.subscriptions.getActive, {
        appUserId: args.appUserId,
      }) as Promise<Subscription[]>,
    ]);
    if (!entitlement?.expiresAtMs) return null;
    const matchingSub = subs.find(
      (s) => s.entitlementIds?.includes(args.entitlementId) ?? false,
    );
    if (!matchingSub || matchingSub.autoRenewStatus !== true) return null;
    return entitlement.expiresAtMs;
  }

  async getExpiresAtMs(
    ctx: QueryCtx,
    args: { appUserId: string; entitlementId: string },
  ): Promise<number | null> {
    const entitlement = await this.getEntitlement(ctx, args);
    return entitlement?.expiresAtMs ?? null;
  }

  async getLatestSubscription(
    ctx: QueryCtx,
    args: { appUserId: string },
  ): Promise<Subscription | null> {
    const subs = (await ctx.runQuery(this.component.subscriptions.getByUser, {
      appUserId: args.appUserId,
    })) as Subscription[];
    if (subs.length === 0) return null;
    return subs.reduce((latest, sub) =>
      sub.purchasedAtMs > latest.purchasedAtMs ? sub : latest,
    );
  }

  private async resolveAppUserId(ctx: AuthCtx): Promise<string> {
    if (this.options.getAppUserId) {
      return await this.options.getAppUserId(ctx);
    }
    const identity = await ctx.auth.getUserIdentity();
    if (!identity?.subject) {
      throw new Error(
        "[convex-revenuecat] Not authenticated. Configure `getAppUserId` " +
          "or call from an authenticated context.",
      );
    }
    return identity.subject;
  }

  api() {
    return {
      getActiveEntitlements: queryGeneric({
        args: {},
        handler: async (ctx) => {
          const appUserId = await this.resolveAppUserId(ctx);
          return await this.getActiveEntitlements(ctx, { appUserId });
        },
      }),
      getActiveSubscriptions: queryGeneric({
        args: {},
        handler: async (ctx) => {
          const appUserId = await this.resolveAppUserId(ctx);
          return await this.getActiveSubscriptions(ctx, { appUserId });
        },
      }),
      getConsumables: queryGeneric({
        args: {},
        handler: async (ctx) => {
          const appUserId = await this.resolveAppUserId(ctx);
          return await this.getConsumables(ctx, { appUserId });
        },
      }),
      getAllEntitlements: queryGeneric({
        args: {},
        handler: async (ctx) => {
          const appUserId = await this.resolveAppUserId(ctx);
          return await this.getAllEntitlements(ctx, { appUserId });
        },
      }),
      getAllSubscriptions: queryGeneric({
        args: {},
        handler: async (ctx) => {
          const appUserId = await this.resolveAppUserId(ctx);
          return await this.getAllSubscriptions(ctx, { appUserId });
        },
      }),
      getSubscriptionsInGracePeriod: queryGeneric({
        args: {},
        handler: async (ctx) => {
          const appUserId = await this.resolveAppUserId(ctx);
          return await this.getSubscriptionsInGracePeriod(ctx, { appUserId });
        },
      }),
      getExperiment: queryGeneric({
        args: { experimentId: v.string() },
        handler: async (ctx, args) => {
          const appUserId = await this.resolveAppUserId(ctx);
          return await this.getExperiment(ctx, {
            appUserId,
            experimentId: args.experimentId,
          });
        },
      }),
      getExperiments: queryGeneric({
        args: {},
        handler: async (ctx) => {
          const appUserId = await this.resolveAppUserId(ctx);
          return await this.getExperiments(ctx, { appUserId });
        },
      }),
      getInvoices: queryGeneric({
        args: {},
        handler: async (ctx) => {
          const appUserId = await this.resolveAppUserId(ctx);
          return await this.getInvoices(ctx, { appUserId });
        },
      }),
      getVirtualCurrencyBalance: queryGeneric({
        args: { currencyCode: v.string() },
        handler: async (ctx, args) => {
          const appUserId = await this.resolveAppUserId(ctx);
          return await this.getVirtualCurrencyBalance(ctx, {
            appUserId,
            currencyCode: args.currencyCode,
          });
        },
      }),
      getVirtualCurrencyBalances: queryGeneric({
        args: {},
        handler: async (ctx) => {
          const appUserId = await this.resolveAppUserId(ctx);
          return await this.getVirtualCurrencyBalances(ctx, { appUserId });
        },
      }),
      getVirtualCurrencyTransactions: queryGeneric({
        args: { currencyCode: v.optional(v.string()) },
        handler: async (ctx, args) => {
          const appUserId = await this.resolveAppUserId(ctx);
          return await this.getVirtualCurrencyTransactions(ctx, {
            appUserId,
            currencyCode: args.currencyCode,
          });
        },
      }),
      getEntitlement: queryGeneric({
        args: { entitlementId: v.string() },
        handler: async (ctx, args) => {
          const appUserId = await this.resolveAppUserId(ctx);
          return await this.getEntitlement(ctx, {
            appUserId,
            entitlementId: args.entitlementId,
          });
        },
      }),
      getRenewsAtMs: queryGeneric({
        args: { entitlementId: v.string() },
        returns: v.union(v.number(), v.null()),
        handler: async (ctx, args) => {
          const appUserId = await this.resolveAppUserId(ctx);
          return await this.getRenewsAtMs(ctx, {
            appUserId,
            entitlementId: args.entitlementId,
          });
        },
      }),
      getExpiresAtMs: queryGeneric({
        args: { entitlementId: v.string() },
        returns: v.union(v.number(), v.null()),
        handler: async (ctx, args) => {
          const appUserId = await this.resolveAppUserId(ctx);
          return await this.getExpiresAtMs(ctx, {
            appUserId,
            entitlementId: args.entitlementId,
          });
        },
      }),
      getCustomer: queryGeneric({
        args: {},
        handler: async (ctx) => {
          const appUserId = await this.resolveAppUserId(ctx);
          return await this.getCustomer(ctx, { appUserId });
        },
      }),
      isSubscriber: queryGeneric({
        args: {},
        returns: v.boolean(),
        handler: async (ctx) => {
          const appUserId = await this.resolveAppUserId(ctx);
          return await this.isSubscriber(ctx, { appUserId });
        },
      }),
      hasAnyEntitlement: queryGeneric({
        args: {},
        returns: v.boolean(),
        handler: async (ctx) => {
          const appUserId = await this.resolveAppUserId(ctx);
          return await this.hasAnyEntitlement(ctx, { appUserId });
        },
      }),
      hasEntitlement: queryGeneric({
        args: { entitlementId: v.string() },
        returns: v.boolean(),
        handler: async (ctx, args) => {
          const appUserId = await this.resolveAppUserId(ctx);
          return await this.hasEntitlement(ctx, {
            appUserId,
            entitlementId: args.entitlementId,
          });
        },
      }),
      isInTrial: queryGeneric({
        args: {},
        returns: v.boolean(),
        handler: async (ctx) => {
          const appUserId = await this.resolveAppUserId(ctx);
          return await this.isInTrial(ctx, { appUserId });
        },
      }),
      wasInTrialEver: queryGeneric({
        args: {},
        returns: v.boolean(),
        handler: async (ctx) => {
          const appUserId = await this.resolveAppUserId(ctx);
          return await this.wasInTrialEver(ctx, { appUserId });
        },
      }),
      getLatestSubscription: queryGeneric({
        args: {},
        handler: async (ctx) => {
          const appUserId = await this.resolveAppUserId(ctx);
          return await this.getLatestSubscription(ctx, { appUserId });
        },
      }),
    };
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
      if (!expectedAuth) {
        console.error(
          "[convex-revenuecat] REVENUECAT_WEBHOOK_AUTH is not set; rejecting webhook. " +
            "Set it via `npx convex env set REVENUECAT_WEBHOOK_AUTH <secret>`.",
        );
        return new Response(
          JSON.stringify({ error: "Webhook auth not configured" }),
          {
            status: 500,
            headers: { "Content-Type": "application/json" },
          },
        );
      }
      validateAuthSecret(expectedAuth);
      const expectedToken = extractAuthToken(expectedAuth).trim();

      const authHeader = request.headers.get("Authorization") ?? "";
      const providedToken = extractAuthToken(authHeader).trim();

      if (
        providedToken.length === 0 ||
        !secureCompare(providedToken, expectedToken)
      ) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        });
      }

      const contentLength = request.headers.get("Content-Length");
      if (contentLength && Number(contentLength) > MAX_WEBHOOK_BODY_BYTES) {
        return new Response(JSON.stringify({ error: "Payload too large" }), {
          status: 413,
          headers: { "Content-Type": "application/json" },
        });
      }

      let body: unknown;
      try {
        const raw = await request.arrayBuffer();
        if (raw.byteLength > MAX_WEBHOOK_BODY_BYTES) {
          return new Response(JSON.stringify({ error: "Payload too large" }), {
            status: 413,
            headers: { "Content-Type": "application/json" },
          });
        }
        body = JSON.parse(new TextDecoder().decode(raw));
      } catch {
        return new Response(JSON.stringify({ error: "Invalid JSON" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }

      const payload = body as {
        api_version?: string;
        event?: Record<string, unknown>;
      };
      const event = payload.event;

      if (
        !event ||
        typeof event.id !== "string" ||
        typeof event.type !== "string"
      ) {
        return new Response(
          JSON.stringify({ error: "Invalid webhook payload" }),
          {
            status: 400,
            headers: { "Content-Type": "application/json" },
          },
        );
      }

      const inboundEnv = event.environment;
      if (
        inboundEnv !== undefined &&
        inboundEnv !== "SANDBOX" &&
        inboundEnv !== "PRODUCTION"
      ) {
        return new Response(JSON.stringify({ error: "Invalid environment" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }

      if (event.id.trim().length === 0 || event.id.length > 128) {
        return new Response(JSON.stringify({ error: "Invalid event id" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (event.type.trim().length === 0) {
        return new Response(JSON.stringify({ error: "Invalid event type" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }

      const transformed = transformPayload(event);
      let sanitizedEvent: Record<string, unknown> =
        transformed &&
        typeof transformed === "object" &&
        !Array.isArray(transformed)
          ? (transformed as Record<string, unknown>)
          : (event as Record<string, unknown>);
      if (redactPayload) {
        try {
          const result = redactPayload(sanitizedEvent);
          if (result && typeof result === "object" && !Array.isArray(result)) {
            sanitizedEvent = result;
          } else {
            console.warn(
              "[convex-revenuecat] redactPayload returned non-object; using unredacted",
            );
          }
        } catch (err) {
          console.warn(
            "[convex-revenuecat] redactPayload threw; using unredacted",
            err,
          );
        }
      }
      const normalizedStore = normalizeStore(event.store) as Store | undefined;
      if (normalizedStore && normalizedStore !== event.store) {
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
          const convexError = error as {
            message?: string;
            data?: {
              code?: string;
              message?: string;
              data?: { resetAt?: number };
            };
          };
          if (convexError.data?.code === "RATE_LIMITED") {
            const resetAt = convexError.data?.data?.resetAt;
            return new Response(
              JSON.stringify({ error: "Rate limit exceeded", resetAt }),
              {
                status: 429,
                headers: {
                  "Content-Type": "application/json",
                  ...(resetAt
                    ? {
                        "Retry-After": String(
                          Math.ceil((resetAt - Date.now()) / 1000),
                        ),
                      }
                    : {}),
                },
              },
            );
          }
          if (convexError.data?.code === "INVALID_ARGUMENT") {
            const failureMessage =
              convexError.data?.message ??
              convexError.message ??
              "INVALID_ARGUMENT";
            try {
              await ctx.runMutation(component.webhooks.recordFailure, {
                event: {
                  id: event.id as string,
                  type: event.type as string,
                  app_id: event.app_id as string | undefined,
                  app_user_id: event.app_user_id as string | undefined,
                  environment:
                    (event.environment as Environment) ?? "PRODUCTION",
                  store: normalizedStore,
                },
                payload: sanitizedEvent,
                error: failureMessage,
              });
            } catch (recordErr) {
              console.error(
                "[convex-revenuecat] recordFailure threw; audit row skipped",
                recordErr,
              );
            }
            return new Response(
              JSON.stringify({ error: "Invalid webhook payload" }),
              {
                status: 400,
                headers: { "Content-Type": "application/json" },
              },
            );
          }
        }
        throw error;
      }
    });
  }

  registerRoutes(http: HttpRouter, opts: { path?: string } = {}): void {
    http.route({
      path: opts.path ?? "/webhooks/revenuecat",
      method: "POST",
      handler: this.httpHandler(),
    });
  }
}
