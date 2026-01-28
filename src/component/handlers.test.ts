import { describe, expect, test } from "vitest";
import { api } from "./_generated/api.js";
import { initConvexTest } from "./setup.test.js";

function createEventPayload(
  overrides: Partial<{
    type: string;
    id: string;
    app_user_id: string;
    original_app_user_id: string;
    product_id: string;
    entitlement_ids: string[];
    expiration_at_ms: number;
    cancel_reason: string;
    expiration_reason: string;
    auto_resume_at_ms: number;
    transferred_from: string[];
    subscriber_attributes: Record<string, { value: string; updated_at_ms: number }>;
    experiments: Array<{
      experiment_id: string;
      experiment_variant: string;
      enrolled_at_ms?: number;
    }>;
  }> = {},
) {
  return {
    type: overrides.type ?? "INITIAL_PURCHASE",
    id: overrides.id ?? `evt_${Date.now()}`,
    app_id: "app_123",
    app_user_id: overrides.app_user_id ?? "user_123",
    original_app_user_id: overrides.original_app_user_id ?? overrides.app_user_id ?? "user_123",
    aliases: [],
    event_timestamp_ms: Date.now(),
    product_id: overrides.product_id ?? "premium_monthly",
    entitlement_ids: overrides.entitlement_ids ?? ["premium"],
    period_type: "NORMAL" as const,
    purchased_at_ms: Date.now(),
    expiration_at_ms: overrides.expiration_at_ms ?? Date.now() + 30 * 24 * 60 * 60 * 1000,
    transaction_id: `txn_${Date.now()}`,
    original_transaction_id: `txn_original_${Date.now()}`,
    store: "APP_STORE" as const,
    environment: "SANDBOX" as const,
    is_family_share: false,
    cancel_reason: overrides.cancel_reason,
    expiration_reason: overrides.expiration_reason,
    auto_resume_at_ms: overrides.auto_resume_at_ms,
    transferred_from: overrides.transferred_from,
    subscriber_attributes: overrides.subscriber_attributes,
    experiments: overrides.experiments,
  };
}

describe("handlers", () => {
  describe("INITIAL_PURCHASE", () => {
    test("grants entitlements", async () => {
      const t = initConvexTest();
      const payload = createEventPayload({
        id: "evt_initial_1",
        type: "INITIAL_PURCHASE",
        app_user_id: "user_initial_1",
        entitlement_ids: ["premium", "pro"],
      });

      await t.mutation(api.webhooks.process, {
        event: {
          id: payload.id,
          type: payload.type,
          app_id: payload.app_id,
          app_user_id: payload.app_user_id,
          environment: payload.environment,
          store: payload.store,
        },
        payload,
      });

      const hasPremium = await t.query(api.entitlements.check, {
        appUserId: "user_initial_1",
        entitlementId: "premium",
      });
      const hasPro = await t.query(api.entitlements.check, {
        appUserId: "user_initial_1",
        entitlementId: "pro",
      });

      expect(hasPremium).toBe(true);
      expect(hasPro).toBe(true);
    });

    test("creates customer record", async () => {
      const t = initConvexTest();
      const payload = createEventPayload({
        id: "evt_initial_2",
        type: "INITIAL_PURCHASE",
        app_user_id: "user_initial_2",
      });

      await t.mutation(api.webhooks.process, {
        event: {
          id: payload.id,
          type: payload.type,
          app_id: payload.app_id,
          app_user_id: payload.app_user_id,
          environment: payload.environment,
          store: payload.store,
        },
        payload,
      });

      const customer = await t.query(api.customers.get, {
        appUserId: "user_initial_2",
      });

      expect(customer).not.toBeNull();
      expect(customer?.appUserId).toBe("user_initial_2");
    });

    test("creates subscription record", async () => {
      const t = initConvexTest();
      const payload = createEventPayload({
        id: "evt_initial_3",
        type: "INITIAL_PURCHASE",
        app_user_id: "user_initial_3",
        product_id: "premium_yearly",
      });

      await t.mutation(api.webhooks.process, {
        event: {
          id: payload.id,
          type: payload.type,
          app_id: payload.app_id,
          app_user_id: payload.app_user_id,
          environment: payload.environment,
          store: payload.store,
        },
        payload,
      });

      const subs = await t.query(api.subscriptions.getByUser, {
        appUserId: "user_initial_3",
      });

      expect(subs.length).toBe(1);
      expect(subs[0].productId).toBe("premium_yearly");
    });
  });

  describe("CANCELLATION", () => {
    test("KEEPS entitlements until expiration", async () => {
      const t = initConvexTest();
      const futureExpiration = Date.now() + 30 * 24 * 60 * 60 * 1000;

      const initialPayload = createEventPayload({
        id: "evt_cancel_1_initial",
        type: "INITIAL_PURCHASE",
        app_user_id: "user_cancel_1",
        expiration_at_ms: futureExpiration,
      });

      await t.mutation(api.webhooks.process, {
        event: {
          id: initialPayload.id,
          type: initialPayload.type,
          app_id: initialPayload.app_id,
          app_user_id: initialPayload.app_user_id,
          environment: initialPayload.environment,
          store: initialPayload.store,
        },
        payload: initialPayload,
      });

      const cancelPayload = createEventPayload({
        id: "evt_cancel_1_cancel",
        type: "CANCELLATION",
        app_user_id: "user_cancel_1",
        expiration_at_ms: futureExpiration,
        cancel_reason: "UNSUBSCRIBE",
      });

      await t.mutation(api.webhooks.process, {
        event: {
          id: cancelPayload.id,
          type: cancelPayload.type,
          app_id: cancelPayload.app_id,
          app_user_id: cancelPayload.app_user_id,
          environment: cancelPayload.environment,
          store: cancelPayload.store,
        },
        payload: cancelPayload,
      });

      const hasPremium = await t.query(api.entitlements.check, {
        appUserId: "user_cancel_1",
        entitlementId: "premium",
      });

      expect(hasPremium).toBe(true);
    });
  });

  describe("EXPIRATION", () => {
    test("REVOKES entitlements", async () => {
      const t = initConvexTest();
      const pastExpiration = Date.now() - 1000;

      const initialPayload = createEventPayload({
        id: "evt_expire_1_initial",
        type: "INITIAL_PURCHASE",
        app_user_id: "user_expire_1",
        expiration_at_ms: Date.now() + 1000,
      });

      await t.mutation(api.webhooks.process, {
        event: {
          id: initialPayload.id,
          type: initialPayload.type,
          app_id: initialPayload.app_id,
          app_user_id: initialPayload.app_user_id,
          environment: initialPayload.environment,
          store: initialPayload.store,
        },
        payload: initialPayload,
      });

      let hasPremium = await t.query(api.entitlements.check, {
        appUserId: "user_expire_1",
        entitlementId: "premium",
      });
      expect(hasPremium).toBe(true);

      const expirePayload = createEventPayload({
        id: "evt_expire_1_expire",
        type: "EXPIRATION",
        app_user_id: "user_expire_1",
        expiration_at_ms: pastExpiration,
        expiration_reason: "SUBSCRIPTION_EXPIRED",
      });

      await t.mutation(api.webhooks.process, {
        event: {
          id: expirePayload.id,
          type: expirePayload.type,
          app_id: expirePayload.app_id,
          app_user_id: expirePayload.app_user_id,
          environment: expirePayload.environment,
          store: expirePayload.store,
        },
        payload: expirePayload,
      });

      hasPremium = await t.query(api.entitlements.check, {
        appUserId: "user_expire_1",
        entitlementId: "premium",
      });

      expect(hasPremium).toBe(false);
    });
  });

  describe("SUBSCRIPTION_PAUSED", () => {
    test("does NOT revoke entitlements", async () => {
      const t = initConvexTest();
      const futureExpiration = Date.now() + 30 * 24 * 60 * 60 * 1000;
      const futureResume = Date.now() + 60 * 24 * 60 * 60 * 1000;

      const initialPayload = createEventPayload({
        id: "evt_pause_1_initial",
        type: "INITIAL_PURCHASE",
        app_user_id: "user_pause_1",
        expiration_at_ms: futureExpiration,
      });

      await t.mutation(api.webhooks.process, {
        event: {
          id: initialPayload.id,
          type: initialPayload.type,
          app_id: initialPayload.app_id,
          app_user_id: initialPayload.app_user_id,
          environment: initialPayload.environment,
          store: initialPayload.store,
        },
        payload: initialPayload,
      });

      const pausePayload = createEventPayload({
        id: "evt_pause_1_pause",
        type: "SUBSCRIPTION_PAUSED",
        app_user_id: "user_pause_1",
        expiration_at_ms: futureExpiration,
        auto_resume_at_ms: futureResume,
      });

      await t.mutation(api.webhooks.process, {
        event: {
          id: pausePayload.id,
          type: pausePayload.type,
          app_id: pausePayload.app_id,
          app_user_id: pausePayload.app_user_id,
          environment: pausePayload.environment,
          store: pausePayload.store,
        },
        payload: pausePayload,
      });

      const hasPremium = await t.query(api.entitlements.check, {
        appUserId: "user_pause_1",
        entitlementId: "premium",
      });

      expect(hasPremium).toBe(true);
    });
  });

  describe("TRANSFER", () => {
    test("moves entitlements from source to destination user", async () => {
      const t = initConvexTest();
      const futureExpiration = Date.now() + 30 * 24 * 60 * 60 * 1000;

      const initialPayload = createEventPayload({
        id: "evt_transfer_1_initial",
        type: "INITIAL_PURCHASE",
        app_user_id: "user_source",
        entitlement_ids: ["premium"],
        expiration_at_ms: futureExpiration,
      });

      await t.mutation(api.webhooks.process, {
        event: {
          id: initialPayload.id,
          type: initialPayload.type,
          app_id: initialPayload.app_id,
          app_user_id: initialPayload.app_user_id,
          environment: initialPayload.environment,
          store: initialPayload.store,
        },
        payload: initialPayload,
      });

      let sourceHas = await t.query(api.entitlements.check, {
        appUserId: "user_source",
        entitlementId: "premium",
      });
      expect(sourceHas).toBe(true);

      const transferPayload = {
        id: "evt_transfer_1_transfer",
        type: "TRANSFER",
        app_id: "app_123",
        event_timestamp_ms: Date.now(),
        store: "APP_STORE" as const,
        environment: "SANDBOX" as const,
        transferred_from: ["user_source"],
        transferred_to: ["user_dest"],
        entitlement_ids: ["premium"],
      };

      await t.mutation(api.webhooks.process, {
        event: {
          id: transferPayload.id,
          type: transferPayload.type,
          app_id: transferPayload.app_id,
          environment: transferPayload.environment,
          store: transferPayload.store,
        },
        payload: transferPayload,
      });

      sourceHas = await t.query(api.entitlements.check, {
        appUserId: "user_source",
        entitlementId: "premium",
      });
      expect(sourceHas).toBe(false);

      const destHas = await t.query(api.entitlements.check, {
        appUserId: "user_dest",
        entitlementId: "premium",
      });
      expect(destHas).toBe(true);
    });
  });

  describe("BILLING_ISSUE", () => {
    test("keeps entitlements during grace period", async () => {
      const t = initConvexTest();
      const futureExpiration = Date.now() + 30 * 24 * 60 * 60 * 1000;
      const gracePeriodExpiration = Date.now() + 7 * 24 * 60 * 60 * 1000;

      const initialPayload = createEventPayload({
        id: "evt_billing_1_initial",
        type: "INITIAL_PURCHASE",
        app_user_id: "user_billing_1",
        expiration_at_ms: futureExpiration,
      });

      await t.mutation(api.webhooks.process, {
        event: {
          id: initialPayload.id,
          type: initialPayload.type,
          app_id: initialPayload.app_id,
          app_user_id: initialPayload.app_user_id,
          environment: initialPayload.environment,
          store: initialPayload.store,
        },
        payload: initialPayload,
      });

      const billingPayload = {
        ...createEventPayload({
          id: "evt_billing_1_issue",
          type: "BILLING_ISSUE",
          app_user_id: "user_billing_1",
          expiration_at_ms: futureExpiration,
        }),
        grace_period_expiration_at_ms: gracePeriodExpiration,
      };

      await t.mutation(api.webhooks.process, {
        event: {
          id: billingPayload.id,
          type: billingPayload.type,
          app_id: billingPayload.app_id,
          app_user_id: billingPayload.app_user_id,
          environment: billingPayload.environment,
          store: billingPayload.store,
        },
        payload: billingPayload,
      });

      const hasPremium = await t.query(api.entitlements.check, {
        appUserId: "user_billing_1",
        entitlementId: "premium",
      });

      expect(hasPremium).toBe(true);

      const entitlements = await t.query(api.entitlements.list, {
        appUserId: "user_billing_1",
      });

      expect(entitlements.length).toBe(1);
      expect(entitlements[0].billingIssueDetectedAt).toBeDefined();
    });
  });

  describe("RENEWAL", () => {
    test("extends entitlement expiration", async () => {
      const t = initConvexTest();
      const initialExpiration = Date.now() + 30 * 24 * 60 * 60 * 1000;
      const renewedExpiration = Date.now() + 60 * 24 * 60 * 60 * 1000;

      const initialPayload = createEventPayload({
        id: "evt_renew_1_initial",
        type: "INITIAL_PURCHASE",
        app_user_id: "user_renew_1",
        expiration_at_ms: initialExpiration,
      });

      await t.mutation(api.webhooks.process, {
        event: {
          id: initialPayload.id,
          type: initialPayload.type,
          app_id: initialPayload.app_id,
          app_user_id: initialPayload.app_user_id,
          environment: initialPayload.environment,
          store: initialPayload.store,
        },
        payload: initialPayload,
      });

      const renewPayload = createEventPayload({
        id: "evt_renew_1_renew",
        type: "RENEWAL",
        app_user_id: "user_renew_1",
        expiration_at_ms: renewedExpiration,
      });

      await t.mutation(api.webhooks.process, {
        event: {
          id: renewPayload.id,
          type: renewPayload.type,
          app_id: renewPayload.app_id,
          app_user_id: renewPayload.app_user_id,
          environment: renewPayload.environment,
          store: renewPayload.store,
        },
        payload: renewPayload,
      });

      const hasPremium = await t.query(api.entitlements.check, {
        appUserId: "user_renew_1",
        entitlementId: "premium",
      });

      expect(hasPremium).toBe(true);

      const entitlements = await t.query(api.entitlements.list, {
        appUserId: "user_renew_1",
      });

      expect(entitlements.length).toBe(1);
      expect(entitlements[0].expiresAtMs).toBe(renewedExpiration);
    });
  });

  describe("UNCANCELLATION", () => {
    test("clears cancel reason and restores auto-renew", async () => {
      const t = initConvexTest();
      const futureExpiration = Date.now() + 30 * 24 * 60 * 60 * 1000;
      const sharedTransactionId = "txn_uncancel_shared";

      const initialPayload = {
        ...createEventPayload({
          id: "evt_uncancel_1_initial",
          type: "INITIAL_PURCHASE",
          app_user_id: "user_uncancel_1",
          expiration_at_ms: futureExpiration,
        }),
        original_transaction_id: sharedTransactionId,
        transaction_id: sharedTransactionId,
      };

      await t.mutation(api.webhooks.process, {
        event: {
          id: initialPayload.id,
          type: initialPayload.type,
          app_id: initialPayload.app_id,
          app_user_id: initialPayload.app_user_id,
          environment: initialPayload.environment,
          store: initialPayload.store,
        },
        payload: initialPayload,
      });

      const cancelPayload = {
        ...createEventPayload({
          id: "evt_uncancel_1_cancel",
          type: "CANCELLATION",
          app_user_id: "user_uncancel_1",
          expiration_at_ms: futureExpiration,
          cancel_reason: "UNSUBSCRIBE",
        }),
        original_transaction_id: sharedTransactionId,
        transaction_id: sharedTransactionId,
      };

      await t.mutation(api.webhooks.process, {
        event: {
          id: cancelPayload.id,
          type: cancelPayload.type,
          app_id: cancelPayload.app_id,
          app_user_id: cancelPayload.app_user_id,
          environment: cancelPayload.environment,
          store: cancelPayload.store,
        },
        payload: cancelPayload,
      });

      let subs = await t.query(api.subscriptions.getByUser, {
        appUserId: "user_uncancel_1",
      });
      expect(subs[0].cancelReason).toBe("UNSUBSCRIBE");
      expect(subs[0].autoRenewStatus).toBe(false);

      const uncancelPayload = {
        ...createEventPayload({
          id: "evt_uncancel_1_uncancel",
          type: "UNCANCELLATION",
          app_user_id: "user_uncancel_1",
          expiration_at_ms: futureExpiration,
        }),
        original_transaction_id: sharedTransactionId,
        transaction_id: sharedTransactionId,
      };

      await t.mutation(api.webhooks.process, {
        event: {
          id: uncancelPayload.id,
          type: uncancelPayload.type,
          app_id: uncancelPayload.app_id,
          app_user_id: uncancelPayload.app_user_id,
          environment: uncancelPayload.environment,
          store: uncancelPayload.store,
        },
        payload: uncancelPayload,
      });

      subs = await t.query(api.subscriptions.getByUser, {
        appUserId: "user_uncancel_1",
      });
      expect(subs[0].cancelReason).toBeUndefined();
      expect(subs[0].autoRenewStatus).toBe(true);

      const hasPremium = await t.query(api.entitlements.check, {
        appUserId: "user_uncancel_1",
        entitlementId: "premium",
      });
      expect(hasPremium).toBe(true);
    });
  });

  describe("SUBSCRIPTION_EXTENDED", () => {
    test("extends subscription and entitlement expiration", async () => {
      const t = initConvexTest();
      const initialExpiration = Date.now() + 30 * 24 * 60 * 60 * 1000;
      const extendedExpiration = Date.now() + 90 * 24 * 60 * 60 * 1000;

      const initialPayload = createEventPayload({
        id: "evt_extend_1_initial",
        type: "INITIAL_PURCHASE",
        app_user_id: "user_extend_1",
        expiration_at_ms: initialExpiration,
      });

      await t.mutation(api.webhooks.process, {
        event: {
          id: initialPayload.id,
          type: initialPayload.type,
          app_id: initialPayload.app_id,
          app_user_id: initialPayload.app_user_id,
          environment: initialPayload.environment,
          store: initialPayload.store,
        },
        payload: initialPayload,
      });

      const extendPayload = createEventPayload({
        id: "evt_extend_1_extend",
        type: "SUBSCRIPTION_EXTENDED",
        app_user_id: "user_extend_1",
        expiration_at_ms: extendedExpiration,
      });

      await t.mutation(api.webhooks.process, {
        event: {
          id: extendPayload.id,
          type: extendPayload.type,
          app_id: extendPayload.app_id,
          app_user_id: extendPayload.app_user_id,
          environment: extendPayload.environment,
          store: extendPayload.store,
        },
        payload: extendPayload,
      });

      const entitlements = await t.query(api.entitlements.list, {
        appUserId: "user_extend_1",
      });

      expect(entitlements.length).toBe(1);
      expect(entitlements[0].expiresAtMs).toBe(extendedExpiration);
      expect(entitlements[0].isActive).toBe(true);
    });
  });

  describe("PRODUCT_CHANGE", () => {
    test("updates subscription product (informational)", async () => {
      const t = initConvexTest();
      const futureExpiration = Date.now() + 30 * 24 * 60 * 60 * 1000;
      const sharedTransactionId = "txn_product_change_shared";

      const initialPayload = {
        ...createEventPayload({
          id: "evt_product_1_initial",
          type: "INITIAL_PURCHASE",
          app_user_id: "user_product_1",
          product_id: "monthly_basic",
          expiration_at_ms: futureExpiration,
        }),
        original_transaction_id: sharedTransactionId,
        transaction_id: sharedTransactionId,
      };

      await t.mutation(api.webhooks.process, {
        event: {
          id: initialPayload.id,
          type: initialPayload.type,
          app_id: initialPayload.app_id,
          app_user_id: initialPayload.app_user_id,
          environment: initialPayload.environment,
          store: initialPayload.store,
        },
        payload: initialPayload,
      });

      const changePayload = {
        ...createEventPayload({
          id: "evt_product_1_change",
          type: "PRODUCT_CHANGE",
          app_user_id: "user_product_1",
          product_id: "monthly_basic",
          expiration_at_ms: futureExpiration,
        }),
        original_transaction_id: sharedTransactionId,
        transaction_id: sharedTransactionId,
        new_product_id: "yearly_premium",
      };

      await t.mutation(api.webhooks.process, {
        event: {
          id: changePayload.id,
          type: changePayload.type,
          app_id: changePayload.app_id,
          app_user_id: changePayload.app_user_id,
          environment: changePayload.environment,
          store: changePayload.store,
        },
        payload: changePayload,
      });

      const subs = await t.query(api.subscriptions.getByUser, {
        appUserId: "user_product_1",
      });

      expect(subs.length).toBe(1);
      expect(subs[0].newProductId).toBe("yearly_premium");

      const hasPremium = await t.query(api.entitlements.check, {
        appUserId: "user_product_1",
        entitlementId: "premium",
      });
      expect(hasPremium).toBe(true);
    });
  });

  describe("NON_RENEWING_PURCHASE", () => {
    test("grants entitlements for one-time purchase", async () => {
      const t = initConvexTest();
      const futureExpiration = Date.now() + 365 * 24 * 60 * 60 * 1000;

      const payload = createEventPayload({
        id: "evt_nonrenew_1",
        type: "NON_RENEWING_PURCHASE",
        app_user_id: "user_nonrenew_1",
        product_id: "lifetime_access",
        entitlement_ids: ["premium", "exclusive"],
        expiration_at_ms: futureExpiration,
      });

      await t.mutation(api.webhooks.process, {
        event: {
          id: payload.id,
          type: payload.type,
          app_id: payload.app_id,
          app_user_id: payload.app_user_id,
          environment: payload.environment,
          store: payload.store,
        },
        payload,
      });

      const hasPremium = await t.query(api.entitlements.check, {
        appUserId: "user_nonrenew_1",
        entitlementId: "premium",
      });
      const hasExclusive = await t.query(api.entitlements.check, {
        appUserId: "user_nonrenew_1",
        entitlementId: "exclusive",
      });

      expect(hasPremium).toBe(true);
      expect(hasExclusive).toBe(true);

      const subs = await t.query(api.subscriptions.getByUser, {
        appUserId: "user_nonrenew_1",
      });

      expect(subs.length).toBe(1);
      expect(subs[0].productId).toBe("lifetime_access");
    });
  });

  describe("TEMPORARY_ENTITLEMENT_GRANT", () => {
    test("grants temporary entitlements during store outage", async () => {
      const t = initConvexTest();
      const tempExpiration = Date.now() + 24 * 60 * 60 * 1000; // 24 hours

      const payload = createEventPayload({
        id: "evt_temp_1",
        type: "TEMPORARY_ENTITLEMENT_GRANT",
        app_user_id: "user_temp_1",
        entitlement_ids: ["premium"],
        expiration_at_ms: tempExpiration,
      });

      await t.mutation(api.webhooks.process, {
        event: {
          id: payload.id,
          type: payload.type,
          app_id: payload.app_id,
          app_user_id: payload.app_user_id,
          environment: payload.environment,
          store: payload.store,
        },
        payload,
      });

      const hasPremium = await t.query(api.entitlements.check, {
        appUserId: "user_temp_1",
        entitlementId: "premium",
      });

      expect(hasPremium).toBe(true);

      const entitlements = await t.query(api.entitlements.list, {
        appUserId: "user_temp_1",
      });

      expect(entitlements.length).toBe(1);
      expect(entitlements[0].expiresAtMs).toBe(tempExpiration);
    });
  });

  describe("REFUND_REVERSED", () => {
    test("restores entitlements after refund is undone", async () => {
      const t = initConvexTest();
      const futureExpiration = Date.now() + 30 * 24 * 60 * 60 * 1000;

      const initialPayload = createEventPayload({
        id: "evt_refund_rev_1_initial",
        type: "INITIAL_PURCHASE",
        app_user_id: "user_refund_rev_1",
        expiration_at_ms: futureExpiration,
      });

      await t.mutation(api.webhooks.process, {
        event: {
          id: initialPayload.id,
          type: initialPayload.type,
          app_id: initialPayload.app_id,
          app_user_id: initialPayload.app_user_id,
          environment: initialPayload.environment,
          store: initialPayload.store,
        },
        payload: initialPayload,
      });

      const expirePayload = createEventPayload({
        id: "evt_refund_rev_1_expire",
        type: "EXPIRATION",
        app_user_id: "user_refund_rev_1",
        expiration_at_ms: Date.now() - 1000,
        expiration_reason: "CUSTOMER_SUPPORT",
      });

      await t.mutation(api.webhooks.process, {
        event: {
          id: expirePayload.id,
          type: expirePayload.type,
          app_id: expirePayload.app_id,
          app_user_id: expirePayload.app_user_id,
          environment: expirePayload.environment,
          store: expirePayload.store,
        },
        payload: expirePayload,
      });

      let hasPremium = await t.query(api.entitlements.check, {
        appUserId: "user_refund_rev_1",
        entitlementId: "premium",
      });
      expect(hasPremium).toBe(false);

      const refundReversedPayload = createEventPayload({
        id: "evt_refund_rev_1_reversed",
        type: "REFUND_REVERSED",
        app_user_id: "user_refund_rev_1",
        expiration_at_ms: futureExpiration,
      });

      await t.mutation(api.webhooks.process, {
        event: {
          id: refundReversedPayload.id,
          type: refundReversedPayload.type,
          app_id: refundReversedPayload.app_id,
          app_user_id: refundReversedPayload.app_user_id,
          environment: refundReversedPayload.environment,
          store: refundReversedPayload.store,
        },
        payload: refundReversedPayload,
      });

      hasPremium = await t.query(api.entitlements.check, {
        appUserId: "user_refund_rev_1",
        entitlementId: "premium",
      });
      expect(hasPremium).toBe(true);
    });
  });

  describe("TEST", () => {
    test("processes test event without errors", async () => {
      const t = initConvexTest();

      const payload = {
        id: "evt_test_1",
        type: "TEST",
        event_timestamp_ms: Date.now(),
        environment: "SANDBOX" as const,
      };

      const result = await t.mutation(api.webhooks.process, {
        event: {
          id: payload.id,
          type: payload.type,
          environment: payload.environment,
        },
        payload,
      });

      expect(result.processed).toBe(true);
    });
  });

  describe("INVOICE_ISSUANCE", () => {
    test("processes invoice issuance event", async () => {
      const t = initConvexTest();

      const payload = {
        id: "evt_invoice_1",
        type: "INVOICE_ISSUANCE",
        event_timestamp_ms: Date.now(),
        app_user_id: "user_invoice_1",
        environment: "PRODUCTION" as const,
        invoice_id: "inv_123",
      };

      const result = await t.mutation(api.webhooks.process, {
        event: {
          id: payload.id,
          type: payload.type,
          app_user_id: payload.app_user_id,
          environment: payload.environment,
        },
        payload,
      });

      expect(result.processed).toBe(true);
    });
  });

  describe("VIRTUAL_CURRENCY_TRANSACTION", () => {
    test("processes virtual currency transaction event", async () => {
      const t = initConvexTest();

      const payload = {
        id: "evt_vcurrency_1",
        type: "VIRTUAL_CURRENCY_TRANSACTION",
        event_timestamp_ms: Date.now(),
        app_user_id: "user_vcurrency_1",
        environment: "PRODUCTION" as const,
        store: "APP_STORE" as const,
        adjustments: [{ amount: 100, currency: { code: "coins", name: "Coins" } }],
        virtual_currency_transaction_id: "vct_123",
        source: "in_app_purchase",
      };

      const result = await t.mutation(api.webhooks.process, {
        event: {
          id: payload.id,
          type: payload.type,
          app_user_id: payload.app_user_id,
          environment: payload.environment,
          store: payload.store,
        },
        payload,
      });

      expect(result.processed).toBe(true);
    });
  });

  describe("EXPERIMENT_ENROLLMENT", () => {
    test("processes experiment enrollment event", async () => {
      const t = initConvexTest();

      const payload = {
        id: "evt_experiment_1",
        type: "EXPERIMENT_ENROLLMENT",
        event_timestamp_ms: Date.now(),
        app_user_id: "user_experiment_1",
        environment: "PRODUCTION" as const,
        experiment_id: "exp_123",
        experiment_variant: "treatment_a",
        offering_id: "offering_premium",
        experiment_enrolled_at_ms: Date.now(),
      };

      const result = await t.mutation(api.webhooks.process, {
        event: {
          id: payload.id,
          type: payload.type,
          app_user_id: payload.app_user_id,
          environment: payload.environment,
        },
        payload,
      });

      expect(result.processed).toBe(true);
    });

    test("stores experiment enrollment in database", async () => {
      const t = initConvexTest();
      const enrolledAt = Date.now();

      const payload = {
        id: "evt_experiment_2",
        type: "EXPERIMENT_ENROLLMENT",
        event_timestamp_ms: enrolledAt,
        app_user_id: "user_experiment_2",
        environment: "PRODUCTION" as const,
        experiment_id: "exp_pricing_test",
        experiment_variant: "variant_b",
        offering_id: "offering_premium",
        experiment_enrolled_at_ms: enrolledAt,
      };

      await t.mutation(api.webhooks.process, {
        event: {
          id: payload.id,
          type: payload.type,
          app_user_id: payload.app_user_id,
          environment: payload.environment,
        },
        payload,
      });

      const experiment = await t.query(api.experiments.get, {
        appUserId: "user_experiment_2",
        experimentId: "exp_pricing_test",
      });

      expect(experiment).not.toBeNull();
      expect(experiment?.variant).toBe("variant_b");
      expect(experiment?.offeringId).toBe("offering_premium");
      expect(experiment?.enrolledAtMs).toBe(enrolledAt);
    });
  });

  describe("Subscriber Attributes", () => {
    test("stores subscriber_attributes on customer", async () => {
      const t = initConvexTest();

      const payload = createEventPayload({
        id: "evt_attrs_1",
        type: "INITIAL_PURCHASE",
        app_user_id: "user_attrs_1",
        subscriber_attributes: {
          __dollar__email: {
            value: "test@example.com",
            updated_at_ms: Date.now(),
          },
          custom_plan: {
            value: "enterprise",
            updated_at_ms: Date.now(),
          },
        },
      });

      await t.mutation(api.webhooks.process, {
        event: {
          id: payload.id,
          type: payload.type,
          app_id: payload.app_id,
          app_user_id: payload.app_user_id,
          environment: payload.environment,
          store: payload.store,
        },
        payload,
      });

      const customer = await t.query(api.customers.get, {
        appUserId: "user_attrs_1",
      });

      expect(customer).not.toBeNull();
      expect(customer?.attributes).toBeDefined();
      expect(customer?.attributes?.__dollar__email?.value).toBe("test@example.com");
      expect(customer?.attributes?.custom_plan?.value).toBe("enterprise");
    });

    test("merges newer subscriber_attributes", async () => {
      const t = initConvexTest();
      const oldTime = Date.now() - 10000;
      const newTime = Date.now();

      const payload1 = createEventPayload({
        id: "evt_attrs_merge_1",
        type: "INITIAL_PURCHASE",
        app_user_id: "user_attrs_merge",
        subscriber_attributes: {
          __dollar__email: {
            value: "old@example.com",
            updated_at_ms: oldTime,
          },
          plan: {
            value: "starter",
            updated_at_ms: oldTime,
          },
        },
      });

      await t.mutation(api.webhooks.process, {
        event: {
          id: payload1.id,
          type: payload1.type,
          app_id: payload1.app_id,
          app_user_id: payload1.app_user_id,
          environment: payload1.environment,
          store: payload1.store,
        },
        payload: payload1,
      });

      const payload2 = createEventPayload({
        id: "evt_attrs_merge_2",
        type: "RENEWAL",
        app_user_id: "user_attrs_merge",
        subscriber_attributes: {
          __dollar__email: {
            value: "new@example.com",
            updated_at_ms: newTime,
          },
          plan: {
            value: "free", // older timestamp, should not overwrite
            updated_at_ms: oldTime - 5000,
          },
        },
      });

      await t.mutation(api.webhooks.process, {
        event: {
          id: payload2.id,
          type: payload2.type,
          app_id: payload2.app_id,
          app_user_id: payload2.app_user_id,
          environment: payload2.environment,
          store: payload2.store,
        },
        payload: payload2,
      });

      const customer = await t.query(api.customers.get, {
        appUserId: "user_attrs_merge",
      });

      expect(customer?.attributes?.__dollar__email?.value).toBe("new@example.com"); // newer
      expect(customer?.attributes?.plan?.value).toBe("starter"); // older kept
    });
  });

  describe("Experiments from Purchase Events", () => {
    test("stores experiments from INITIAL_PURCHASE", async () => {
      const t = initConvexTest();
      const enrolledAt = Date.now() - 5000;

      const payload = createEventPayload({
        id: "evt_exp_purchase_1",
        type: "INITIAL_PURCHASE",
        app_user_id: "user_exp_purchase",
        experiments: [
          {
            experiment_id: "exp_paywall_test",
            experiment_variant: "variant_a",
            enrolled_at_ms: enrolledAt,
          },
        ],
      });

      await t.mutation(api.webhooks.process, {
        event: {
          id: payload.id,
          type: payload.type,
          app_id: payload.app_id,
          app_user_id: payload.app_user_id,
          environment: payload.environment,
          store: payload.store,
        },
        payload,
      });

      const experiments = await t.query(api.experiments.list, {
        appUserId: "user_exp_purchase",
      });

      expect(experiments).toHaveLength(1);
      expect(experiments[0].experimentId).toBe("exp_paywall_test");
      expect(experiments[0].variant).toBe("variant_a");
    });

    test("stores multiple experiments from single event", async () => {
      const t = initConvexTest();

      const payload = createEventPayload({
        id: "evt_multi_exp_1",
        type: "INITIAL_PURCHASE",
        app_user_id: "user_multi_exp",
        experiments: [
          {
            experiment_id: "exp_pricing",
            experiment_variant: "high_price",
          },
          {
            experiment_id: "exp_onboarding",
            experiment_variant: "skip_tutorial",
          },
        ],
      });

      await t.mutation(api.webhooks.process, {
        event: {
          id: payload.id,
          type: payload.type,
          app_id: payload.app_id,
          app_user_id: payload.app_user_id,
          environment: payload.environment,
          store: payload.store,
        },
        payload,
      });

      const experiments = await t.query(api.experiments.list, {
        appUserId: "user_multi_exp",
      });

      expect(experiments).toHaveLength(2);
      const experimentIds = experiments.map((e) => e.experimentId);
      expect(experimentIds).toContain("exp_pricing");
      expect(experimentIds).toContain("exp_onboarding");
    });
  });

  describe("SUBSCRIBER_ALIAS (deprecated)", () => {
    test("processes subscriber alias event and updates customer", async () => {
      const t = initConvexTest();

      const initialPayload = createEventPayload({
        id: "evt_alias_setup",
        type: "INITIAL_PURCHASE",
        app_user_id: "user_alias_test",
      });

      await t.mutation(api.webhooks.process, {
        event: {
          id: initialPayload.id,
          type: initialPayload.type,
          app_user_id: initialPayload.app_user_id,
          environment: initialPayload.environment,
          store: initialPayload.store,
        },
        payload: initialPayload,
      });

      const aliasPayload = {
        id: "evt_alias_1",
        type: "SUBSCRIBER_ALIAS",
        event_timestamp_ms: Date.now(),
        app_user_id: "user_alias_test",
        original_app_user_id: "user_alias_test",
        aliases: ["alias_1", "alias_2"],
        environment: "SANDBOX" as const,
      };

      const result = await t.mutation(api.webhooks.process, {
        event: {
          id: aliasPayload.id,
          type: aliasPayload.type,
          app_user_id: aliasPayload.app_user_id,
          environment: aliasPayload.environment,
        },
        payload: aliasPayload,
      });

      expect(result.processed).toBe(true);

      const customer = await t.query(api.customers.get, {
        appUserId: "user_alias_test",
      });

      expect(customer).not.toBeNull();
      expect(customer?.aliases).toContain("alias_1");
      expect(customer?.aliases).toContain("alias_2");
    });
  });
});
