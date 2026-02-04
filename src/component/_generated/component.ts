/* eslint-disable */
/**
 * Generated `ComponentApi` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type { FunctionReference } from "convex/server";

type Store =
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

type Environment = "SANDBOX" | "PRODUCTION";
type PeriodType = "TRIAL" | "INTRO" | "NORMAL" | "PROMOTIONAL" | "PREPAID";

interface EntitlementDoc {
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

interface SubscriptionDoc {
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

interface CustomerDoc {
  _id: string;
  _creationTime: number;
  appUserId: string;
  originalAppUserId: string;
  aliases: string[];
  firstSeenAt: number;
  lastSeenAt?: number;
  attributes?: any;
  updatedAt: number;
}

interface ExperimentDoc {
  _id: string;
  _creationTime: number;
  appUserId: string;
  experimentId: string;
  variant: string;
  enrolledAtMs: number;
  updatedAt: number;
}

type WebhookEventStatus = "processed" | "failed" | "ignored";

interface WebhookEventDoc {
  _id: string;
  _creationTime: number;
  eventId: string;
  eventType: string;
  appId?: string;
  appUserId?: string;
  environment: Environment;
  store?: Store;
  payload: any;
  processedAt: number;
  status: WebhookEventStatus;
  error?: string;
}

type Duration =
  | "daily"
  | "three_day"
  | "weekly"
  | "monthly"
  | "two_month"
  | "three_month"
  | "six_month"
  | "yearly"
  | "lifetime";

/**
 * A utility for referencing a Convex component's exposed API.
 */
export type ComponentApi<Name extends string | undefined = string | undefined> = {
  api: {
    /**
     * Get customer from RevenueCat API (v2)
     * Requires: sk_* format API key and projectId
     */
    getCustomer: FunctionReference<
      "action",
      "internal",
      { apiKey: string; projectId: string; appUserId: string },
      any,
      Name
    >;
    /**
     * Grant promotional entitlement via RevenueCat API (v1)
     * Requires: v1 API key (NOT sk_* format) - v2 does not support this operation
     */
    grantEntitlement: FunctionReference<
      "action",
      "internal",
      {
        apiKey: string;
        appUserId: string;
        entitlementId: string;
        duration: Duration;
      },
      any,
      Name
    >;
    /**
     * Revoke promotional entitlement via RevenueCat API (v1)
     * Requires: v1 API key (NOT sk_* format) - v2 does not support this operation
     */
    revokeEntitlement: FunctionReference<
      "action",
      "internal",
      {
        apiKey: string;
        appUserId: string;
        entitlementId: string;
      },
      any,
      Name
    >;
    /**
     * Delete a customer from RevenueCat (v1)
     * Use for GDPR compliance / right to deletion requests.
     */
    deleteCustomer: FunctionReference<
      "action",
      "internal",
      {
        apiKey: string;
        appUserId: string;
      },
      { deleted: boolean; app_user_id: string },
      Name
    >;
    /**
     * Update customer attributes via RevenueCat API (v1)
     */
    updateAttributes: FunctionReference<
      "action",
      "internal",
      {
        apiKey: string;
        appUserId: string;
        attributes: Record<string, { value: string | null; updated_at_ms?: number }>;
      },
      { success: boolean },
      Name
    >;
    /**
     * Get offerings for a customer via RevenueCat API (v1)
     */
    getOfferings: FunctionReference<
      "action",
      "internal",
      {
        apiKey: string;
        appUserId: string;
        platform?: "ios" | "android" | "amazon" | "macos" | "uikitformac";
      },
      any,
      Name
    >;
  };
  customers: {
    get: FunctionReference<"query", "internal", { appUserId: string }, CustomerDoc | null, Name>;
    getByOriginalId: FunctionReference<
      "query",
      "internal",
      { originalAppUserId: string },
      CustomerDoc | null,
      Name
    >;
    upsert: FunctionReference<
      "mutation",
      "internal",
      {
        appUserId: string;
        originalAppUserId: string;
        aliases: string[];
        firstSeenAt?: number;
        lastSeenAt?: number;
        attributes?: any;
      },
      string,
      Name
    >;
  };
  entitlements: {
    check: FunctionReference<
      "query",
      "internal",
      { appUserId: string; entitlementId: string },
      boolean,
      Name
    >;
    list: FunctionReference<"query", "internal", { appUserId: string }, EntitlementDoc[], Name>;
    getActive: FunctionReference<
      "query",
      "internal",
      { appUserId: string },
      EntitlementDoc[],
      Name
    >;
    grant: FunctionReference<
      "mutation",
      "internal",
      {
        appUserId: string;
        entitlementId: string;
        productId?: string;
        expiresAtMs?: number;
        purchasedAtMs?: number;
        store?: Store;
        isSandbox: boolean;
      },
      string,
      Name
    >;
    revoke: FunctionReference<
      "mutation",
      "internal",
      { appUserId: string; entitlementId: string },
      boolean,
      Name
    >;
    sync: FunctionReference<
      "mutation",
      "internal",
      {
        appUserId: string;
        entitlementIds: string[];
        productId?: string;
        expiresAtMs?: number;
        store?: Store;
        isSandbox: boolean;
      },
      { granted: string[]; revoked: string[] },
      Name
    >;
  };
  subscriptions: {
    getByUser: FunctionReference<
      "query",
      "internal",
      { appUserId: string },
      SubscriptionDoc[],
      Name
    >;
    getActive: FunctionReference<
      "query",
      "internal",
      { appUserId: string },
      SubscriptionDoc[],
      Name
    >;
    getByOriginalTransaction: FunctionReference<
      "query",
      "internal",
      { originalTransactionId: string },
      SubscriptionDoc | null,
      Name
    >;
    upsert: FunctionReference<
      "mutation",
      "internal",
      {
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
      },
      string,
      Name
    >;
  };
  webhooks: {
    process: FunctionReference<
      "mutation",
      "internal",
      {
        event: {
          id: string;
          type: string;
          app_id?: string;
          app_user_id?: string;
          environment: Environment;
          store?: Store;
        };
        payload: any;
        _skipRateLimit?: boolean;
      },
      { processed: boolean; eventId: string; rateLimited?: boolean },
      Name
    >;
    checkRateLimit: FunctionReference<
      "mutation",
      "internal",
      { key: string },
      { allowed: boolean; remaining: number; resetAt: number },
      Name
    >;
  };
  experiments: {
    list: FunctionReference<"query", "internal", { appUserId: string }, ExperimentDoc[], Name>;
    get: FunctionReference<
      "query",
      "internal",
      { appUserId: string; experimentId: string },
      ExperimentDoc | null,
      Name
    >;
    listByExperiment: FunctionReference<
      "query",
      "internal",
      { experimentId: string },
      ExperimentDoc[],
      Name
    >;
  };
  webhookEvents: {
    getByEventId: FunctionReference<
      "query",
      "internal",
      { eventId: string },
      WebhookEventDoc | null,
      Name
    >;
    listByUser: FunctionReference<
      "query",
      "internal",
      { appUserId: string; limit?: number },
      WebhookEventDoc[],
      Name
    >;
    listByType: FunctionReference<
      "query",
      "internal",
      { eventType: string; limit?: number },
      WebhookEventDoc[],
      Name
    >;
    listFailed: FunctionReference<"query", "internal", { limit?: number }, WebhookEventDoc[], Name>;
  };
};
