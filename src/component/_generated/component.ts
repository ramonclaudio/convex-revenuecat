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

/**
 * A utility for referencing a Convex component's exposed API.
 *
 * Useful when expecting a parameter like `components.myComponent`.
 * Usage:
 * ```ts
 * async function myFunction(ctx: QueryCtx, component: ComponentApi) {
 *   return ctx.runQuery(component.someFile.someQuery, { ...args });
 * }
 * ```
 */
export type ComponentApi<Name extends string | undefined = string | undefined> =
  {
    customers: {
      get: FunctionReference<
        "query",
        "internal",
        { appUserId: string },
        null | {
          _creationTime: number;
          _id: string;
          aliases: Array<string>;
          appUserId: string;
          attributes?: Record<string, { updated_at_ms: number; value: string }>;
          countryCode?: string;
          firstSeenAt: number;
          lastSeenAt?: number;
          managementUrl?: string;
          originalAppUserId: string;
          updatedAt: number;
        },
        Name
      >;
      purge: FunctionReference<
        "mutation",
        "internal",
        { appUserId: string; batchSize?: number; onCustomerDeleted?: string },
        {
          customer: number;
          done: boolean;
          entitlements: number;
          experiments: number;
          invoices: number;
          subscriptions: number;
          transfers: number;
          virtualCurrencyBalances: number;
          virtualCurrencyTransactions: number;
          webhookEvents: number;
        },
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
      getActive: FunctionReference<
        "query",
        "internal",
        { appUserId: string },
        Array<{
          _creationTime: number;
          _id: string;
          appUserId: string;
          billingIssueDetectedAt?: number;
          entitlementId: string;
          expiresAtMs?: number;
          isActive: boolean;
          isSandbox: boolean;
          ownershipType?: "PURCHASED" | "FAMILY_SHARED" | "UNKNOWN";
          productId?: string;
          purchasedAtMs?: number;
          store?:
            | "AMAZON"
            | "APP_STORE"
            | "MAC_APP_STORE"
            | "GALAXY"
            | "PADDLE"
            | "PLAY_STORE"
            | "PROMOTIONAL"
            | "RC_BILLING"
            | "ROKU"
            | "STRIPE"
            | "TEST_STORE"
            | "EXTERNAL"
            | "UNKNOWN_STORE";
          unsubscribeDetectedAt?: number;
          updatedAt: number;
        }>,
        Name
      >;
      list: FunctionReference<
        "query",
        "internal",
        { appUserId: string },
        Array<{
          _creationTime: number;
          _id: string;
          appUserId: string;
          billingIssueDetectedAt?: number;
          entitlementId: string;
          expiresAtMs?: number;
          isActive: boolean;
          isSandbox: boolean;
          ownershipType?: "PURCHASED" | "FAMILY_SHARED" | "UNKNOWN";
          productId?: string;
          purchasedAtMs?: number;
          store?:
            | "AMAZON"
            | "APP_STORE"
            | "MAC_APP_STORE"
            | "GALAXY"
            | "PADDLE"
            | "PLAY_STORE"
            | "PROMOTIONAL"
            | "RC_BILLING"
            | "ROKU"
            | "STRIPE"
            | "TEST_STORE"
            | "EXTERNAL"
            | "UNKNOWN_STORE";
          unsubscribeDetectedAt?: number;
          updatedAt: number;
        }>,
        Name
      >;
    };
    experiments: {
      get: FunctionReference<
        "query",
        "internal",
        { appUserId: string; experimentId: string },
        null | {
          _creationTime: number;
          _id: string;
          appUserId: string;
          enrolledAtMs: number;
          experimentId: string;
          offeringId?: string;
          updatedAt: number;
          variant: string;
        },
        Name
      >;
      list: FunctionReference<
        "query",
        "internal",
        { appUserId: string },
        Array<{
          _creationTime: number;
          _id: string;
          appUserId: string;
          enrolledAtMs: number;
          experimentId: string;
          offeringId?: string;
          updatedAt: number;
          variant: string;
        }>,
        Name
      >;
    };
    invoices: {
      get: FunctionReference<
        "query",
        "internal",
        { invoiceId: string },
        {
          _creationTime: number;
          _id: string;
          appUserId: string;
          currency?: string;
          environment: "SANDBOX" | "PRODUCTION";
          invoiceId: string;
          issuedAt: number;
          priceInPurchasedCurrency?: number;
          priceUsd?: number;
          productId?: string;
          store?:
            | "AMAZON"
            | "APP_STORE"
            | "MAC_APP_STORE"
            | "GALAXY"
            | "PADDLE"
            | "PLAY_STORE"
            | "PROMOTIONAL"
            | "RC_BILLING"
            | "ROKU"
            | "STRIPE"
            | "TEST_STORE"
            | "EXTERNAL"
            | "UNKNOWN_STORE";
        } | null,
        Name
      >;
      listByUser: FunctionReference<
        "query",
        "internal",
        { appUserId: string },
        Array<{
          _creationTime: number;
          _id: string;
          appUserId: string;
          currency?: string;
          environment: "SANDBOX" | "PRODUCTION";
          invoiceId: string;
          issuedAt: number;
          priceInPurchasedCurrency?: number;
          priceUsd?: number;
          productId?: string;
          store?:
            | "AMAZON"
            | "APP_STORE"
            | "MAC_APP_STORE"
            | "GALAXY"
            | "PADDLE"
            | "PLAY_STORE"
            | "PROMOTIONAL"
            | "RC_BILLING"
            | "ROKU"
            | "STRIPE"
            | "TEST_STORE"
            | "EXTERNAL"
            | "UNKNOWN_STORE";
        }>,
        Name
      >;
    };
    subscriptions: {
      backfillKind: FunctionReference<
        "mutation",
        "internal",
        { cursor?: string; pageSize?: number },
        { nextCursor: string | null; scanned: number; written: number },
        Name
      >;
      getActive: FunctionReference<
        "query",
        "internal",
        { appUserId: string },
        Array<{
          _creationTime: number;
          _id: string;
          appUserId: string;
          autoRenewStatus?: boolean;
          autoResumeAtMs?: number;
          billingIssueDetectedAt?: number;
          cancelReason?: string;
          commissionPercentage?: number;
          countryCode?: string;
          currency?: string;
          entitlementIds?: Array<string>;
          environment: "SANDBOX" | "PRODUCTION";
          expirationAtMs?: number;
          expirationReason?: string;
          gracePeriodExpirationAtMs?: number;
          isFamilyShare: boolean;
          isTrialConversion?: boolean;
          kind?: "subscription" | "consumable";
          newProductId?: string;
          offerCode?: string;
          originalPurchasedAtMs?: number;
          originalTransactionId: string;
          ownershipType?: "PURCHASED" | "FAMILY_SHARED" | "UNKNOWN";
          periodType: "TRIAL" | "INTRO" | "NORMAL" | "PROMOTIONAL" | "PREPAID";
          presentedOfferingId?: string;
          priceInPurchasedCurrency?: number;
          priceUsd?: number;
          productId: string;
          purchasedAtMs: number;
          refundedAtMs?: number;
          renewalNumber?: number;
          store:
            | "AMAZON"
            | "APP_STORE"
            | "MAC_APP_STORE"
            | "GALAXY"
            | "PADDLE"
            | "PLAY_STORE"
            | "PROMOTIONAL"
            | "RC_BILLING"
            | "ROKU"
            | "STRIPE"
            | "TEST_STORE"
            | "EXTERNAL"
            | "UNKNOWN_STORE";
          taxPercentage?: number;
          transactionId: string;
          unsubscribeDetectedAt?: number;
          updatedAt: number;
        }>,
        Name
      >;
      getByUser: FunctionReference<
        "query",
        "internal",
        { appUserId: string },
        Array<{
          _creationTime: number;
          _id: string;
          appUserId: string;
          autoRenewStatus?: boolean;
          autoResumeAtMs?: number;
          billingIssueDetectedAt?: number;
          cancelReason?: string;
          commissionPercentage?: number;
          countryCode?: string;
          currency?: string;
          entitlementIds?: Array<string>;
          environment: "SANDBOX" | "PRODUCTION";
          expirationAtMs?: number;
          expirationReason?: string;
          gracePeriodExpirationAtMs?: number;
          isFamilyShare: boolean;
          isTrialConversion?: boolean;
          kind?: "subscription" | "consumable";
          newProductId?: string;
          offerCode?: string;
          originalPurchasedAtMs?: number;
          originalTransactionId: string;
          ownershipType?: "PURCHASED" | "FAMILY_SHARED" | "UNKNOWN";
          periodType: "TRIAL" | "INTRO" | "NORMAL" | "PROMOTIONAL" | "PREPAID";
          presentedOfferingId?: string;
          priceInPurchasedCurrency?: number;
          priceUsd?: number;
          productId: string;
          purchasedAtMs: number;
          refundedAtMs?: number;
          renewalNumber?: number;
          store:
            | "AMAZON"
            | "APP_STORE"
            | "MAC_APP_STORE"
            | "GALAXY"
            | "PADDLE"
            | "PLAY_STORE"
            | "PROMOTIONAL"
            | "RC_BILLING"
            | "ROKU"
            | "STRIPE"
            | "TEST_STORE"
            | "EXTERNAL"
            | "UNKNOWN_STORE";
          taxPercentage?: number;
          transactionId: string;
          unsubscribeDetectedAt?: number;
          updatedAt: number;
        }>,
        Name
      >;
      getConsumables: FunctionReference<
        "query",
        "internal",
        { appUserId: string },
        Array<{
          _creationTime: number;
          _id: string;
          appUserId: string;
          autoRenewStatus?: boolean;
          autoResumeAtMs?: number;
          billingIssueDetectedAt?: number;
          cancelReason?: string;
          commissionPercentage?: number;
          countryCode?: string;
          currency?: string;
          entitlementIds?: Array<string>;
          environment: "SANDBOX" | "PRODUCTION";
          expirationAtMs?: number;
          expirationReason?: string;
          gracePeriodExpirationAtMs?: number;
          isFamilyShare: boolean;
          isTrialConversion?: boolean;
          kind?: "subscription" | "consumable";
          newProductId?: string;
          offerCode?: string;
          originalPurchasedAtMs?: number;
          originalTransactionId: string;
          ownershipType?: "PURCHASED" | "FAMILY_SHARED" | "UNKNOWN";
          periodType: "TRIAL" | "INTRO" | "NORMAL" | "PROMOTIONAL" | "PREPAID";
          presentedOfferingId?: string;
          priceInPurchasedCurrency?: number;
          priceUsd?: number;
          productId: string;
          purchasedAtMs: number;
          refundedAtMs?: number;
          renewalNumber?: number;
          store:
            | "AMAZON"
            | "APP_STORE"
            | "MAC_APP_STORE"
            | "GALAXY"
            | "PADDLE"
            | "PLAY_STORE"
            | "PROMOTIONAL"
            | "RC_BILLING"
            | "ROKU"
            | "STRIPE"
            | "TEST_STORE"
            | "EXTERNAL"
            | "UNKNOWN_STORE";
          taxPercentage?: number;
          transactionId: string;
          unsubscribeDetectedAt?: number;
          updatedAt: number;
        }>,
        Name
      >;
      getInGracePeriod: FunctionReference<
        "query",
        "internal",
        { appUserId: string },
        Array<{
          _creationTime: number;
          _id: string;
          appUserId: string;
          autoRenewStatus?: boolean;
          autoResumeAtMs?: number;
          billingIssueDetectedAt?: number;
          cancelReason?: string;
          commissionPercentage?: number;
          countryCode?: string;
          currency?: string;
          entitlementIds?: Array<string>;
          environment: "SANDBOX" | "PRODUCTION";
          expirationAtMs?: number;
          expirationReason?: string;
          gracePeriodExpirationAtMs?: number;
          isFamilyShare: boolean;
          isTrialConversion?: boolean;
          kind?: "subscription" | "consumable";
          newProductId?: string;
          offerCode?: string;
          originalPurchasedAtMs?: number;
          originalTransactionId: string;
          ownershipType?: "PURCHASED" | "FAMILY_SHARED" | "UNKNOWN";
          periodType: "TRIAL" | "INTRO" | "NORMAL" | "PROMOTIONAL" | "PREPAID";
          presentedOfferingId?: string;
          priceInPurchasedCurrency?: number;
          priceUsd?: number;
          productId: string;
          purchasedAtMs: number;
          refundedAtMs?: number;
          renewalNumber?: number;
          store:
            | "AMAZON"
            | "APP_STORE"
            | "MAC_APP_STORE"
            | "GALAXY"
            | "PADDLE"
            | "PLAY_STORE"
            | "PROMOTIONAL"
            | "RC_BILLING"
            | "ROKU"
            | "STRIPE"
            | "TEST_STORE"
            | "EXTERNAL"
            | "UNKNOWN_STORE";
          taxPercentage?: number;
          transactionId: string;
          unsubscribeDetectedAt?: number;
          updatedAt: number;
        }>,
        Name
      >;
      isInGracePeriod: FunctionReference<
        "query",
        "internal",
        { originalTransactionId: string },
        {
          billingIssueDetectedAt?: number;
          gracePeriodExpiresAt?: number;
          inGracePeriod: boolean;
        },
        Name
      >;
    };
    sync: {
      ingest: FunctionReference<
        "mutation",
        "internal",
        {
          appUserId: string;
          hooks?: {
            onEntitlementActivated?: string;
            onEntitlementDeactivated?: string;
          };
          subscriber: any;
        },
        {
          entitlements: number;
          nonSubscriptions: number;
          subscriptions: number;
        },
        Name
      >;
    };
    transfers: {
      backfillTransferParticipants: FunctionReference<
        "mutation",
        "internal",
        { cursor?: string; pageSize?: number },
        { nextCursor: string | null; scanned: number; written: number },
        Name
      >;
      getByEventId: FunctionReference<
        "query",
        "internal",
        { eventId: string },
        {
          _creationTime: number;
          _id: string;
          entitlementIds?: Array<string>;
          eventId: string;
          timestamp: number;
          transferredFrom: Array<string>;
          transferredTo: Array<string>;
        } | null,
        Name
      >;
      list: FunctionReference<
        "query",
        "internal",
        { limit?: number },
        Array<{
          _creationTime: number;
          _id: string;
          entitlementIds?: Array<string>;
          eventId: string;
          timestamp: number;
          transferredFrom: Array<string>;
          transferredTo: Array<string>;
        }>,
        Name
      >;
    };
    virtualCurrency: {
      getBalance: FunctionReference<
        "query",
        "internal",
        { appUserId: string; currencyCode: string },
        {
          _creationTime: number;
          _id: string;
          appUserId: string;
          balance: number;
          currencyCode: string;
          currencyName: string;
          updatedAt: number;
        } | null,
        Name
      >;
      listBalances: FunctionReference<
        "query",
        "internal",
        { appUserId: string },
        Array<{
          _creationTime: number;
          _id: string;
          appUserId: string;
          balance: number;
          currencyCode: string;
          currencyName: string;
          updatedAt: number;
        }>,
        Name
      >;
      listTransactions: FunctionReference<
        "query",
        "internal",
        { appUserId: string; currencyCode?: string },
        Array<{
          _creationTime: number;
          _id: string;
          amount: number;
          appUserId: string;
          currencyCode: string;
          environment: "SANDBOX" | "PRODUCTION";
          productId?: string;
          source?: string;
          timestamp: number;
          transactionId: string;
        }>,
        Name
      >;
    };
    webhookEvents: {
      listByUser: FunctionReference<
        "query",
        "internal",
        { appUserId: string; limit?: number },
        Array<{
          _creationTime: number;
          _id: string;
          appId?: string;
          appUserId?: string;
          environment: "SANDBOX" | "PRODUCTION";
          error?: string;
          eventId: string;
          eventType: string;
          payload: any;
          processedAt: number;
          status: "processed" | "failed" | "ignored";
          store?:
            | "AMAZON"
            | "APP_STORE"
            | "MAC_APP_STORE"
            | "GALAXY"
            | "PADDLE"
            | "PLAY_STORE"
            | "PROMOTIONAL"
            | "RC_BILLING"
            | "ROKU"
            | "STRIPE"
            | "TEST_STORE"
            | "EXTERNAL"
            | "UNKNOWN_STORE";
        }>,
        Name
      >;
    };
    webhooks: {
      process: FunctionReference<
        "mutation",
        "internal",
        {
          event: {
            app_id?: string;
            app_user_id?: string;
            environment: "SANDBOX" | "PRODUCTION";
            id: string;
            store?:
              | "AMAZON"
              | "APP_STORE"
              | "MAC_APP_STORE"
              | "GALAXY"
              | "PADDLE"
              | "PLAY_STORE"
              | "PROMOTIONAL"
              | "RC_BILLING"
              | "ROKU"
              | "STRIPE"
              | "TEST_STORE"
              | "EXTERNAL"
              | "UNKNOWN_STORE";
            type: string;
          };
          hooks?: {
            onEntitlementActivated?: string;
            onEntitlementDeactivated?: string;
          };
          payload: any;
        },
        { eventId: string; processed: boolean },
        Name
      >;
      recordFailure: FunctionReference<
        "mutation",
        "internal",
        {
          error: string;
          event: {
            app_id?: string;
            app_user_id?: string;
            environment: "SANDBOX" | "PRODUCTION";
            id: string;
            store?:
              | "AMAZON"
              | "APP_STORE"
              | "MAC_APP_STORE"
              | "GALAXY"
              | "PADDLE"
              | "PLAY_STORE"
              | "PROMOTIONAL"
              | "RC_BILLING"
              | "ROKU"
              | "STRIPE"
              | "TEST_STORE"
              | "EXTERNAL"
              | "UNKNOWN_STORE";
            type: string;
          };
          payload: any;
        },
        null,
        Name
      >;
    };
  };
