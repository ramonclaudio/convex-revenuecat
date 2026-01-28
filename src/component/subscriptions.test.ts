
import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api.js";
import { initConvexTest } from "./setup.test.js";

const makeEventPayload = (overrides: Record<string, unknown> = {}) => ({
  type: "INITIAL_PURCHASE",
  id: `evt_${Date.now()}`,
  app_id: "app_123",
  app_user_id: "user_123",
  original_app_user_id: "user_123",
  aliases: ["user_123"],
  event_timestamp_ms: Date.now(),
  product_id: "premium_monthly",
  entitlement_ids: ["premium"],
  period_type: "NORMAL" as const,
  purchased_at_ms: Date.now(),
  expiration_at_ms: Date.now() + 30 * 24 * 60 * 60 * 1000,
  transaction_id: "txn_123",
  original_transaction_id: "txn_123",
  store: "APP_STORE" as const,
  environment: "SANDBOX" as const,
  is_family_share: false,
  ...overrides,
});

describe("subscriptions", () => {
  test("getByUser returns empty array when no subscriptions", async () => {
    const t = initConvexTest();

    const result = await t.query(api.subscriptions.getByUser, {
      appUserId: "user_123",
    });

    expect(result).toEqual([]);
  });

  test("processInitialPurchase creates subscription", async () => {
    const t = initConvexTest();

    await t.mutation(internal.handlers.processInitialPurchase, {
      event: makeEventPayload({
        app_user_id: "user_new",
        original_transaction_id: "txn_new",
      }),
    });

    const subs = await t.query(api.subscriptions.getByUser, {
      appUserId: "user_new",
    });

    expect(subs).toHaveLength(1);
    expect(subs[0].productId).toBe("premium_monthly");
  });

  test("processRenewal updates existing subscription", async () => {
    const t = initConvexTest();

    await t.mutation(internal.handlers.processInitialPurchase, {
      event: makeEventPayload({
        app_user_id: "user_456",
        original_transaction_id: "txn_456",
        period_type: "TRIAL" as const,
      }),
    });

    await t.mutation(internal.handlers.processRenewal, {
      event: makeEventPayload({
        app_user_id: "user_456",
        original_transaction_id: "txn_456",
        transaction_id: "txn_456_renewal",
        period_type: "NORMAL" as const,
        is_trial_conversion: true,
      }),
    });

    const subs = await t.query(api.subscriptions.getByUser, {
      appUserId: "user_456",
    });

    expect(subs).toHaveLength(1);
    expect(subs[0].periodType).toBe("NORMAL");
    expect(subs[0].isTrialConversion).toBe(true);
  });

  test("getActive filters expired subscriptions", async () => {
    const t = initConvexTest();

    await t.mutation(internal.handlers.processInitialPurchase, {
      event: makeEventPayload({
        app_user_id: "user_789",
        original_transaction_id: "txn_active",
        expiration_at_ms: Date.now() + 30 * 24 * 60 * 60 * 1000,
      }),
    });

    await t.mutation(internal.handlers.processInitialPurchase, {
      event: makeEventPayload({
        app_user_id: "user_789",
        product_id: "basic_monthly",
        original_transaction_id: "txn_expired",
        purchased_at_ms: Date.now() - 60 * 24 * 60 * 60 * 1000,
        expiration_at_ms: Date.now() - 1000,
      }),
    });

    const active = await t.query(api.subscriptions.getActive, {
      appUserId: "user_789",
    });

    expect(active).toHaveLength(1);
    expect(active[0].productId).toBe("premium_monthly");
  });

  test("getByOriginalTransaction finds subscription", async () => {
    const t = initConvexTest();

    await t.mutation(internal.handlers.processInitialPurchase, {
      event: makeEventPayload({
        app_user_id: "user_lookup",
        store: "PLAY_STORE" as const,
        environment: "PRODUCTION" as const,
        original_transaction_id: "GPA.1234-5678",
      }),
    });

    const sub = await t.query(api.subscriptions.getByOriginalTransaction, {
      originalTransactionId: "GPA.1234-5678",
    });

    expect(sub).not.toBeNull();
    expect(sub?.appUserId).toBe("user_lookup");
  });

  test("getByOriginalTransaction returns null when not found", async () => {
    const t = initConvexTest();

    const sub = await t.query(api.subscriptions.getByOriginalTransaction, {
      originalTransactionId: "nonexistent",
    });

    expect(sub).toBeNull();
  });

  test("processCancellation sets cancel reason but keeps entitlements", async () => {
    const t = initConvexTest();

    await t.mutation(internal.handlers.processInitialPurchase, {
      event: makeEventPayload({
        app_user_id: "user_cancel",
        original_transaction_id: "txn_cancel",
      }),
    });

    await t.mutation(internal.handlers.processCancellation, {
      event: makeEventPayload({
        app_user_id: "user_cancel",
        original_transaction_id: "txn_cancel",
        cancel_reason: "CUSTOMER_SUPPORT",
      }),
    });

    const subs = await t.query(api.subscriptions.getByUser, {
      appUserId: "user_cancel",
    });

    expect(subs[0].cancelReason).toBe("CUSTOMER_SUPPORT");
    expect(subs[0].autoRenewStatus).toBe(false);

    const entitlements = await t.query(api.entitlements.getActive, {
      appUserId: "user_cancel",
    });
    expect(entitlements).toHaveLength(1);
  });

  test("processExpiration revokes entitlements", async () => {
    const t = initConvexTest();

    await t.mutation(internal.handlers.processInitialPurchase, {
      event: makeEventPayload({
        app_user_id: "user_expire",
        original_transaction_id: "txn_expire",
      }),
    });

    await t.mutation(internal.handlers.processExpiration, {
      event: makeEventPayload({
        app_user_id: "user_expire",
        original_transaction_id: "txn_expire",
        expiration_reason: "SUBSCRIPTION_EXPIRED",
      }),
    });

    const entitlements = await t.query(api.entitlements.getActive, {
      appUserId: "user_expire",
    });
    expect(entitlements).toHaveLength(0);
  });

  test("getActive includes subscription in grace period", async () => {
    const t = initConvexTest();

    await t.mutation(internal.handlers.processInitialPurchase, {
      event: makeEventPayload({
        app_user_id: "user_grace_sub",
        original_transaction_id: "txn_grace",
        expiration_at_ms: Date.now() - 1000, // Already expired
      }),
    });

    await t.mutation(internal.handlers.processBillingIssue, {
      event: makeEventPayload({
        app_user_id: "user_grace_sub",
        original_transaction_id: "txn_grace",
        grace_period_expiration_at_ms: Date.now() + 7 * 24 * 60 * 60 * 1000,
      }),
    });

    const active = await t.query(api.subscriptions.getActive, {
      appUserId: "user_grace_sub",
    });

    expect(active).toHaveLength(1);
  });

  test("getActive excludes subscription after grace period expires", async () => {
    const t = initConvexTest();
    const pastExpiration = Date.now() - 10000;
    const pastGracePeriod = Date.now() - 1000;

    await t.mutation(internal.handlers.processInitialPurchase, {
      event: makeEventPayload({
        app_user_id: "user_grace_expired",
        original_transaction_id: "txn_grace_expired",
        expiration_at_ms: pastExpiration,
      }),
    });

    await t.mutation(internal.handlers.processBillingIssue, {
      event: makeEventPayload({
        app_user_id: "user_grace_expired",
        original_transaction_id: "txn_grace_expired",
        expiration_at_ms: pastExpiration,
        grace_period_expiration_at_ms: pastGracePeriod,
      }),
    });

    const active = await t.query(api.subscriptions.getActive, {
      appUserId: "user_grace_expired",
    });

    expect(active).toHaveLength(0);
  });

  test("billing issue → renewal clears grace period state", async () => {
    const t = initConvexTest();

    await t.mutation(internal.handlers.processInitialPurchase, {
      event: makeEventPayload({
        app_user_id: "user_recovered",
        original_transaction_id: "txn_recovered",
        expiration_at_ms: Date.now() - 1000,
      }),
    });

    await t.mutation(internal.handlers.processBillingIssue, {
      event: makeEventPayload({
        app_user_id: "user_recovered",
        original_transaction_id: "txn_recovered",
        grace_period_expiration_at_ms: Date.now() + 7 * 24 * 60 * 60 * 1000,
      }),
    });

    await t.mutation(internal.handlers.processRenewal, {
      event: makeEventPayload({
        app_user_id: "user_recovered",
        original_transaction_id: "txn_recovered",
        expiration_at_ms: Date.now() + 30 * 24 * 60 * 60 * 1000,
      }),
    });

    const subs = await t.query(api.subscriptions.getByUser, {
      appUserId: "user_recovered",
    });

    expect(subs[0].billingIssueDetectedAt).toBeUndefined();
    expect(subs[0].gracePeriodExpirationAtMs).toBeUndefined();
  });
});
