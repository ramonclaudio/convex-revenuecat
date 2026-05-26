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
    subscriber_attributes: Record<
      string,
      { value: string; updated_at_ms: number }
    >;
    experiments: Array<{
      experiment_id: string;
      experiment_variant: string;
      enrolled_at_ms?: number;
    }>;
    original_transaction_id: string;
    transaction_id: string;
  }> = {},
) {
  return {
    type: overrides.type ?? "INITIAL_PURCHASE",
    id: overrides.id ?? `evt_${Date.now()}`,
    app_id: "app_123",
    app_user_id: overrides.app_user_id ?? "user_123",
    original_app_user_id:
      overrides.original_app_user_id ?? overrides.app_user_id ?? "user_123",
    aliases: [],
    event_timestamp_ms: Date.now(),
    product_id: overrides.product_id ?? "premium_monthly",
    entitlement_ids: overrides.entitlement_ids ?? ["premium"],
    period_type: "NORMAL" as const,
    purchased_at_ms: Date.now(),
    expiration_at_ms:
      overrides.expiration_at_ms ?? Date.now() + 30 * 24 * 60 * 60 * 1000,
    transaction_id: overrides.transaction_id ?? `txn_${Date.now()}`,
    original_transaction_id:
      overrides.original_transaction_id ?? `txn_original_${Date.now()}`,
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

    test("derives isFamilyShare from ownership_type when is_family_share is absent", async () => {
      const t = initConvexTest();
      const payload = {
        ...createEventPayload({
          id: "evt_derive_family_share",
          type: "INITIAL_PURCHASE",
          app_user_id: "user_derive_family",
          entitlement_ids: ["premium"],
        }),
        is_family_share: undefined,
        ownership_type: "FAMILY_SHARED",
      };
      await t.mutation(api.webhooks.process, {
        event: {
          id: payload.id,
          type: payload.type,
          app_user_id: payload.app_user_id,
          environment: payload.environment,
          store: payload.store,
        },
        payload,
      });

      const subs = await t.query(api.subscriptions.getByUser, {
        appUserId: "user_derive_family",
      });
      expect(subs).toHaveLength(1);
      expect(subs[0].isFamilyShare).toBe(true);
      expect(subs[0].ownershipType).toBe("FAMILY_SHARED");
    });

    test("propagates ownership_type to the entitlement (FAMILY_SHARED)", async () => {
      const t = initConvexTest();
      const payload = {
        ...createEventPayload({
          id: "evt_own_type",
          type: "INITIAL_PURCHASE",
          app_user_id: "user_family",
          entitlement_ids: ["premium"],
        }),
        ownership_type: "FAMILY_SHARED",
      };
      await t.mutation(api.webhooks.process, {
        event: {
          id: payload.id,
          type: payload.type,
          app_user_id: payload.app_user_id,
          environment: payload.environment,
          store: payload.store,
        },
        payload,
      });

      const ents = await t.query(api.entitlements.list, {
        appUserId: "user_family",
      });
      expect(ents).toHaveLength(1);
      expect(ents[0].ownershipType).toBe("FAMILY_SHARED");
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

    test("REVOKES entitlements when cancel_reason is CUSTOMER_SUPPORT (refund)", async () => {
      const t = initConvexTest();
      const futureExpiration = Date.now() + 30 * 24 * 60 * 60 * 1000;

      const initialPayload = createEventPayload({
        id: "evt_cancel_refund_initial",
        type: "INITIAL_PURCHASE",
        app_user_id: "user_cancel_refund",
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

      expect(
        await t.query(api.entitlements.check, {
          appUserId: "user_cancel_refund",
          entitlementId: "premium",
        }),
      ).toBe(true);

      // RC emits refunds as CANCELLATION with cancel_reason CUSTOMER_SUPPORT
      // (no distinct REFUND event for new projects as of 2026).
      const refundPayload = createEventPayload({
        id: "evt_cancel_refund_cancel",
        type: "CANCELLATION",
        app_user_id: "user_cancel_refund",
        expiration_at_ms: futureExpiration,
        cancel_reason: "CUSTOMER_SUPPORT",
      });
      await t.mutation(api.webhooks.process, {
        event: {
          id: refundPayload.id,
          type: refundPayload.type,
          app_id: refundPayload.app_id,
          app_user_id: refundPayload.app_user_id,
          environment: refundPayload.environment,
          store: refundPayload.store,
        },
        payload: refundPayload,
      });

      expect(
        await t.query(api.entitlements.check, {
          appUserId: "user_cancel_refund",
          entitlementId: "premium",
        }),
      ).toBe(false);
    });

    test("upserts experiments present on the event (not just on purchase events)", async () => {
      const t = initConvexTest();
      const experimentsArr = [
        {
          experiment_id: "exp_cancel_path",
          experiment_variant: "variant_c",
          offering_id: "offering_x",
          enrolled_at_ms: Date.now(),
        },
      ];

      const initialPayload = createEventPayload({
        id: "evt_cancel_exp_initial",
        type: "INITIAL_PURCHASE",
        app_user_id: "user_cancel_exp",
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

      const cancelPayload = {
        ...createEventPayload({
          id: "evt_cancel_exp_cancel",
          type: "CANCELLATION",
          app_user_id: "user_cancel_exp",
          cancel_reason: "UNSUBSCRIBE",
        }),
        experiments: experimentsArr,
      };
      await t.mutation(api.webhooks.process, {
        event: {
          id: cancelPayload.id,
          type: cancelPayload.type,
          app_user_id: cancelPayload.app_user_id,
          environment: cancelPayload.environment,
          store: cancelPayload.store,
        },
        payload: cancelPayload,
      });

      const exp = await t.query(api.experiments.get, {
        appUserId: "user_cancel_exp",
        experimentId: "exp_cancel_path",
      });
      expect(exp).not.toBeNull();
      expect(exp?.variant).toBe("variant_c");
      expect(exp?.offeringId).toBe("offering_x");
    });

    test("sets refundedAtMs on the subscription when CUSTOMER_SUPPORT refund lands", async () => {
      const t = initConvexTest();
      const refundTime = Date.now();

      const initialPayload = createEventPayload({
        id: "evt_refund_ts_initial",
        type: "INITIAL_PURCHASE",
        app_user_id: "user_refund_ts",
        original_transaction_id: "txn_refund_ts",
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

      const cancelPayload = {
        ...createEventPayload({
          id: "evt_refund_ts_cancel",
          type: "CANCELLATION",
          app_user_id: "user_refund_ts",
          original_transaction_id: "txn_refund_ts",
          cancel_reason: "CUSTOMER_SUPPORT",
        }),
        event_timestamp_ms: refundTime,
      };
      await t.mutation(api.webhooks.process, {
        event: {
          id: cancelPayload.id,
          type: cancelPayload.type,
          app_user_id: cancelPayload.app_user_id,
          environment: cancelPayload.environment,
          store: cancelPayload.store,
        },
        payload: cancelPayload,
      });

      const subs = await t.query(api.subscriptions.getByUser, {
        appUserId: "user_refund_ts",
      });
      expect(subs[0].refundedAtMs).toBe(refundTime);
    });

    test("does NOT set refundedAtMs on a non-refund cancellation", async () => {
      const t = initConvexTest();

      const initialPayload = createEventPayload({
        id: "evt_nrefund_initial",
        type: "INITIAL_PURCHASE",
        app_user_id: "user_nrefund",
        original_transaction_id: "txn_nrefund",
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

      const cancelPayload = createEventPayload({
        id: "evt_nrefund_cancel",
        type: "CANCELLATION",
        app_user_id: "user_nrefund",
        original_transaction_id: "txn_nrefund",
        cancel_reason: "UNSUBSCRIBE",
      });
      await t.mutation(api.webhooks.process, {
        event: {
          id: cancelPayload.id,
          type: cancelPayload.type,
          app_user_id: cancelPayload.app_user_id,
          environment: cancelPayload.environment,
          store: cancelPayload.store,
        },
        payload: cancelPayload,
      });

      const subs = await t.query(api.subscriptions.getByUser, {
        appUserId: "user_nrefund",
      });
      expect(subs[0].refundedAtMs).toBeUndefined();
    });

    test("REVOKES entitlements on CANCELLATION with negative price (e.g. Google self-serve refund)", async () => {
      const t = initConvexTest();
      const futureExpiration = Date.now() + 30 * 24 * 60 * 60 * 1000;

      const initialPayload = createEventPayload({
        id: "evt_cancel_negprice_initial",
        type: "INITIAL_PURCHASE",
        app_user_id: "user_cancel_negprice",
        expiration_at_ms: futureExpiration,
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

      // Google Play self-serve refund: cancel_reason may not flip to
      // CUSTOMER_SUPPORT, but price goes negative. Must revoke.
      const refundPayload = {
        ...createEventPayload({
          id: "evt_cancel_negprice_cancel",
          type: "CANCELLATION",
          app_user_id: "user_cancel_negprice",
          expiration_at_ms: futureExpiration,
          cancel_reason: "DEVELOPER_INITIATED",
        }),
        price: -9.99,
      };
      await t.mutation(api.webhooks.process, {
        event: {
          id: refundPayload.id,
          type: refundPayload.type,
          app_user_id: refundPayload.app_user_id,
          environment: refundPayload.environment,
          store: refundPayload.store,
        },
        payload: refundPayload,
      });

      expect(
        await t.query(api.entitlements.check, {
          appUserId: "user_cancel_negprice",
          entitlementId: "premium",
        }),
      ).toBe(false);
    });

    test("does NOT revoke unrelated entitlements on CUSTOMER_SUPPORT cancellation with no entitlement_ids", async () => {
      const t = initConvexTest();

      const purchasePayload = createEventPayload({
        id: "evt_cancel_refund_multi_initial",
        type: "INITIAL_PURCHASE",
        app_user_id: "user_cancel_refund_multi",
        entitlement_ids: ["premium"],
        expiration_at_ms: Date.now() + 30 * 24 * 60 * 60 * 1000,
      });
      await t.mutation(api.webhooks.process, {
        event: {
          id: purchasePayload.id,
          type: purchasePayload.type,
          app_user_id: purchasePayload.app_user_id,
          environment: purchasePayload.environment,
          store: purchasePayload.store,
        },
        payload: purchasePayload,
      });

      const refundPayload = {
        ...createEventPayload({
          id: "evt_cancel_refund_multi_cancel",
          type: "CANCELLATION",
          app_user_id: "user_cancel_refund_multi",
          cancel_reason: "CUSTOMER_SUPPORT",
        }),
        entitlement_ids: undefined,
      };
      await t.mutation(api.webhooks.process, {
        event: {
          id: refundPayload.id,
          type: refundPayload.type,
          app_user_id: refundPayload.app_user_id,
          environment: refundPayload.environment,
          store: refundPayload.store,
        },
        payload: refundPayload,
      });

      expect(
        await t.query(api.entitlements.check, {
          appUserId: "user_cancel_refund_multi",
          entitlementId: "premium",
        }),
      ).toBe(true);
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

    test("does NOT revoke unrelated entitlements when entitlement_ids is absent", async () => {
      const t = initConvexTest();

      // User has two active subscriptions: premium and pro
      const premiumPayload = createEventPayload({
        id: "evt_expire_guard_premium",
        type: "INITIAL_PURCHASE",
        app_user_id: "user_expire_guard",
        entitlement_ids: ["premium"],
        expiration_at_ms: Date.now() + 30 * 24 * 60 * 60 * 1000,
      });
      const proPayload = createEventPayload({
        id: "evt_expire_guard_pro",
        type: "INITIAL_PURCHASE",
        app_user_id: "user_expire_guard",
        entitlement_ids: ["pro"],
        expiration_at_ms: Date.now() + 30 * 24 * 60 * 60 * 1000,
      });

      for (const p of [premiumPayload, proPayload]) {
        await t.mutation(api.webhooks.process, {
          event: {
            id: p.id,
            type: p.type,
            app_id: p.app_id,
            app_user_id: p.app_user_id,
            environment: p.environment,
            store: p.store,
          },
          payload: p,
        });
      }

      // EXPIRATION fires for a product NOT mapped to any entitlement (entitlement_ids absent)
      const expirePayload = {
        ...createEventPayload({
          id: "evt_expire_guard_expire",
          type: "EXPIRATION",
          app_user_id: "user_expire_guard",
          expiration_at_ms: Date.now() - 1000,
        }),
        entitlement_ids: undefined,
      };

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

      // Both entitlements should still be active, neither was targeted
      expect(
        await t.query(api.entitlements.check, {
          appUserId: "user_expire_guard",
          entitlementId: "premium",
        }),
      ).toBe(true);
      expect(
        await t.query(api.entitlements.check, {
          appUserId: "user_expire_guard",
          entitlementId: "pro",
        }),
      ).toBe(true);
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

  describe("TRANSFER (destination has existing entitlement)", () => {
    test("patches existing entitlement on destination user", async () => {
      const t = initConvexTest();
      const futureExpiration = Date.now() + 30 * 24 * 60 * 60 * 1000;
      const newerExpiration = Date.now() + 60 * 24 * 60 * 60 * 1000;

      const sourcePayload = createEventPayload({
        id: "evt_transfer_dup_source",
        type: "INITIAL_PURCHASE",
        app_user_id: "user_src_dup",
        entitlement_ids: ["premium"],
        expiration_at_ms: newerExpiration,
      });

      await t.mutation(api.webhooks.process, {
        event: {
          id: sourcePayload.id,
          type: sourcePayload.type,
          app_id: sourcePayload.app_id,
          app_user_id: sourcePayload.app_user_id,
          environment: sourcePayload.environment,
          store: sourcePayload.store,
        },
        payload: sourcePayload,
      });

      const destPayload = createEventPayload({
        id: "evt_transfer_dup_dest_setup",
        type: "INITIAL_PURCHASE",
        app_user_id: "user_dst_dup",
        entitlement_ids: ["premium"],
        expiration_at_ms: futureExpiration,
      });

      await t.mutation(api.webhooks.process, {
        event: {
          id: destPayload.id,
          type: destPayload.type,
          app_id: destPayload.app_id,
          app_user_id: destPayload.app_user_id,
          environment: destPayload.environment,
          store: destPayload.store,
        },
        payload: destPayload,
      });

      const transferPayload = {
        id: "evt_transfer_dup_transfer",
        type: "TRANSFER",
        app_id: "app_123",
        event_timestamp_ms: Date.now(),
        store: "APP_STORE" as const,
        environment: "SANDBOX" as const,
        transferred_from: ["user_src_dup"],
        transferred_to: ["user_dst_dup"],
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

      const sourceHas = await t.query(api.entitlements.check, {
        appUserId: "user_src_dup",
        entitlementId: "premium",
      });
      expect(sourceHas).toBe(false);

      const destHas = await t.query(api.entitlements.check, {
        appUserId: "user_dst_dup",
        entitlementId: "premium",
      });
      expect(destHas).toBe(true);

      const destEnts = await t.query(api.entitlements.getActive, {
        appUserId: "user_dst_dup",
      });
      expect(destEnts).toHaveLength(1);
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

    test("does NOT touch a lifetime entitlement's undefined expiresAtMs", async () => {
      const t = initConvexTest();

      // Seed a lifetime entitlement directly.
      const entId = await t.run(async (ctx) =>
        ctx.db.insert("entitlements", {
          appUserId: "user_lifetime_billing",
          entitlementId: "premium",
          isActive: true,
          isSandbox: false,
          updatedAt: Date.now(),
        }),
      );
      const before = await t.run(async (ctx) => ctx.db.get(entId));
      expect(before?.expiresAtMs).toBeUndefined();

      const billingPayload = {
        ...createEventPayload({
          id: "evt_lifetime_billing",
          type: "BILLING_ISSUE",
          app_user_id: "user_lifetime_billing",
        }),
        grace_period_expiration_at_ms: Date.now() + 7 * 24 * 60 * 60 * 1000,
      };
      await t.mutation(api.webhooks.process, {
        event: {
          id: billingPayload.id,
          type: billingPayload.type,
          app_user_id: billingPayload.app_user_id,
          environment: billingPayload.environment,
          store: billingPayload.store,
        },
        payload: billingPayload,
      });

      const after = await t.run(async (ctx) => ctx.db.get(entId));
      // Lifetime entitlement must stay lifetime, never coerce to finite expiry.
      expect(after?.expiresAtMs).toBeUndefined();
    });

    test("extends entitlement expiresAtMs to grace period end (hard ceiling)", async () => {
      const t = initConvexTest();
      const pastExpiration = Date.now() - 1000; // already expired
      const gracePeriodEnd = Date.now() + 7 * 24 * 60 * 60 * 1000;

      const initialPayload = createEventPayload({
        id: "evt_billing_ceiling_initial",
        type: "INITIAL_PURCHASE",
        app_user_id: "user_billing_ceiling",
        expiration_at_ms: Date.now() + 1000, // soon-to-expire
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

      const billingPayload = {
        ...createEventPayload({
          id: "evt_billing_ceiling_issue",
          type: "BILLING_ISSUE",
          app_user_id: "user_billing_ceiling",
          expiration_at_ms: pastExpiration,
        }),
        grace_period_expiration_at_ms: gracePeriodEnd,
      };
      await t.mutation(api.webhooks.process, {
        event: {
          id: billingPayload.id,
          type: billingPayload.type,
          app_user_id: billingPayload.app_user_id,
          environment: billingPayload.environment,
          store: billingPayload.store,
        },
        payload: billingPayload,
      });

      const ents = await t.query(api.entitlements.list, {
        appUserId: "user_billing_ceiling",
      });
      expect(ents).toHaveLength(1);
      // expiresAtMs must be at least the grace end so user keeps access.
      expect(ents[0].expiresAtMs).toBeGreaterThanOrEqual(gracePeriodEnd);
      // User still has access during grace.
      expect(
        await t.query(api.entitlements.check, {
          appUserId: "user_billing_ceiling",
          entitlementId: "premium",
        }),
      ).toBe(true);
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

    test("creates entitlement if missing (e.g. after transfer) rather than silently skipping", async () => {
      const t = initConvexTest();
      const renewedExpiration = Date.now() + 60 * 24 * 60 * 60 * 1000;

      // RENEWAL fires but no prior INITIAL_PURCHASE entitlement record exists
      const renewPayload = createEventPayload({
        id: "evt_renew_missing_ent",
        type: "RENEWAL",
        app_user_id: "user_renew_missing",
        entitlement_ids: ["premium"],
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

      expect(
        await t.query(api.entitlements.check, {
          appUserId: "user_renew_missing",
          entitlementId: "premium",
        }),
      ).toBe(true);
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

      // INVOICE_ISSUANCE uses event.id as the invoice identifier (no separate invoice_id field)
      const payload = {
        id: "evt_invoice_1",
        type: "INVOICE_ISSUANCE",
        event_timestamp_ms: Date.now(),
        app_user_id: "user_invoice_1",
        environment: "PRODUCTION" as const,
        store: "RC_BILLING" as const,
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
        adjustments: [
          { amount: 100, currency: { code: "coins", name: "Coins" } },
        ],
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

    test("stores separate transaction records for each currency in a multi-currency event", async () => {
      const t = initConvexTest();

      const payload = {
        id: "evt_vcurrency_multi",
        type: "VIRTUAL_CURRENCY_TRANSACTION",
        event_timestamp_ms: Date.now(),
        app_user_id: "user_vcurrency_multi",
        environment: "PRODUCTION" as const,
        store: "APP_STORE" as const,
        adjustments: [
          { amount: 100, currency: { code: "coins", name: "Coins" } },
          { amount: 50, currency: { code: "gems", name: "Gems" } },
        ],
        virtual_currency_transaction_id: "vct_multi_1",
        source: "in_app_purchase",
      };

      await t.mutation(api.webhooks.process, {
        event: {
          id: payload.id,
          type: payload.type,
          app_user_id: payload.app_user_id,
          environment: payload.environment,
          store: payload.store,
        },
        payload,
      });

      const coinsBalance = await t.query(api.virtualCurrency.getBalance, {
        appUserId: "user_vcurrency_multi",
        currencyCode: "coins",
      });
      const gemsBalance = await t.query(api.virtualCurrency.getBalance, {
        appUserId: "user_vcurrency_multi",
        currencyCode: "gems",
      });

      expect(coinsBalance?.balance).toBe(100);
      expect(gemsBalance?.balance).toBe(50);

      const transactions = await t.query(api.virtualCurrency.listTransactions, {
        appUserId: "user_vcurrency_multi",
      });

      // Both currency adjustments must have their own transaction record
      expect(transactions.length).toBe(2);
      expect(transactions.map((tx) => tx.currencyCode).sort()).toEqual([
        "coins",
        "gems",
      ]);
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

  describe("Experiment upsert with changed variant", () => {
    test("updates experiment when variant changes", async () => {
      const t = initConvexTest();
      const enrolledAt = Date.now() - 5000;

      const payload1 = createEventPayload({
        id: "evt_exp_upsert_1",
        type: "INITIAL_PURCHASE",
        app_user_id: "user_exp_upsert",
        experiments: [
          {
            experiment_id: "exp_upsert_test",
            experiment_variant: "control",
            enrolled_at_ms: enrolledAt,
          },
        ],
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

      let experiment = await t.query(api.experiments.get, {
        appUserId: "user_exp_upsert",
        experimentId: "exp_upsert_test",
      });
      expect(experiment?.variant).toBe("control");

      const payload2 = createEventPayload({
        id: "evt_exp_upsert_2",
        type: "RENEWAL",
        app_user_id: "user_exp_upsert",
        experiments: [
          {
            experiment_id: "exp_upsert_test",
            experiment_variant: "treatment",
            enrolled_at_ms: enrolledAt + 1000,
          },
        ],
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

      experiment = await t.query(api.experiments.get, {
        appUserId: "user_exp_upsert",
        experimentId: "exp_upsert_test",
      });
      expect(experiment?.variant).toBe("treatment");
      expect(experiment?.enrolledAtMs).toBe(enrolledAt + 1000);
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
      expect(customer?.attributes?.__dollar__email?.value).toBe(
        "test@example.com",
      );
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

      expect(customer?.attributes?.__dollar__email?.value).toBe(
        "new@example.com",
      ); // newer
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

    test("migrates entitlements and subscriptions from anonymous to real user ID", async () => {
      const t = initConvexTest();
      const anonymousId = "$RCAnonymousID:abc123";
      const realUserId = "user_real_1";

      // Purchase happens under anonymous ID
      const purchasePayload = createEventPayload({
        id: "evt_anon_purchase",
        type: "INITIAL_PURCHASE",
        app_user_id: anonymousId,
        entitlement_ids: ["premium"],
      });

      await t.mutation(api.webhooks.process, {
        event: {
          id: purchasePayload.id,
          type: purchasePayload.type,
          app_user_id: purchasePayload.app_user_id,
          environment: purchasePayload.environment,
          store: purchasePayload.store,
        },
        payload: purchasePayload,
      });

      // Confirm real user has no entitlement before alias
      expect(
        await t.query(api.entitlements.check, {
          appUserId: realUserId,
          entitlementId: "premium",
        }),
      ).toBe(false);

      // logIn() fires, RC sends SUBSCRIBER_ALIAS
      // app_user_id = real user, original_app_user_id = anonymous
      const aliasPayload = {
        id: "evt_alias_migrate",
        type: "SUBSCRIBER_ALIAS",
        event_timestamp_ms: Date.now(),
        app_user_id: realUserId,
        original_app_user_id: anonymousId,
        aliases: [realUserId, anonymousId],
        environment: "SANDBOX" as const,
      };

      await t.mutation(api.webhooks.process, {
        event: {
          id: aliasPayload.id,
          type: aliasPayload.type,
          app_user_id: aliasPayload.app_user_id,
          environment: aliasPayload.environment,
        },
        payload: aliasPayload,
      });

      // Real user should now have the entitlement
      expect(
        await t.query(api.entitlements.check, {
          appUserId: realUserId,
          entitlementId: "premium",
        }),
      ).toBe(true);

      // Anonymous ID should no longer have the entitlement
      expect(
        await t.query(api.entitlements.check, {
          appUserId: anonymousId,
          entitlementId: "premium",
        }),
      ).toBe(false);

      // Subscription should be under real user
      const subs = await t.query(api.subscriptions.getActive, {
        appUserId: realUserId,
      });
      expect(subs.length).toBeGreaterThan(0);
    });

    test("preserves billingIssueDetectedAt from source when both users have the same entitlement and source is newer", async () => {
      // Exercises the `if (existing)` + `sourceIsNewer` branch in aliasEntitlements.
      // Bug: patch omitted billingIssueDetectedAt, so a billing-issue flag on the
      // anonymous (source, newer) record was silently dropped onto the real user.
      const t = initConvexTest();
      const anonymousId = "$RCAnonymousID:billing_alias";
      const realUserId = "user_billing_alias_real";
      const now = Date.now();

      // Real user purchases first, shorter expiry (older record)
      const realPurchase = createEventPayload({
        id: "evt_billing_alias_real_purchase",
        type: "INITIAL_PURCHASE",
        app_user_id: realUserId,
        original_app_user_id: realUserId,
        expiration_at_ms: now + 10 * 24 * 60 * 60 * 1000, // +10 days
      });
      await t.mutation(api.webhooks.process, {
        event: {
          id: realPurchase.id,
          type: realPurchase.type,
          app_user_id: realPurchase.app_user_id,
          environment: realPurchase.environment,
          store: realPurchase.store,
        },
        payload: realPurchase,
      });

      // Anonymous user purchases same entitlement, longer expiry (newer record)
      const anonPurchase = createEventPayload({
        id: "evt_billing_alias_anon_purchase",
        type: "INITIAL_PURCHASE",
        app_user_id: anonymousId,
        original_app_user_id: anonymousId,
        expiration_at_ms: now + 30 * 24 * 60 * 60 * 1000, // +30 days (newer)
      });
      await t.mutation(api.webhooks.process, {
        event: {
          id: anonPurchase.id,
          type: anonPurchase.type,
          app_user_id: anonPurchase.app_user_id,
          environment: anonPurchase.environment,
          store: anonPurchase.store,
        },
        payload: anonPurchase,
      });

      // Billing issue on anonymous, stamps billingIssueDetectedAt
      const billingPayload = createEventPayload({
        id: "evt_billing_alias_issue",
        type: "BILLING_ISSUE",
        app_user_id: anonymousId,
        original_app_user_id: anonymousId,
        expiration_at_ms: now + 30 * 24 * 60 * 60 * 1000,
      });
      await t.mutation(api.webhooks.process, {
        event: {
          id: billingPayload.id,
          type: billingPayload.type,
          app_user_id: billingPayload.app_user_id,
          environment: billingPayload.environment,
          store: billingPayload.store,
        },
        payload: billingPayload,
      });

      // Confirm the anonymous entitlement has billingIssueDetectedAt set
      const anonEnts = await t.query(api.entitlements.list, {
        appUserId: anonymousId,
      });
      expect(anonEnts[0].billingIssueDetectedAt).toBeDefined();
      // And the real user's entitlement does NOT yet have it
      const realEntsBefore = await t.query(api.entitlements.list, {
        appUserId: realUserId,
      });
      expect(realEntsBefore[0].billingIssueDetectedAt).toBeUndefined();

      // User logs in, SUBSCRIBER_ALIAS merges anonymous (newer) → real (existing, older)
      // This hits the `if (existing) { if (sourceIsNewer) { patch(...) } }` branch.
      const aliasPayload = {
        id: "evt_billing_alias_merge",
        type: "SUBSCRIBER_ALIAS",
        event_timestamp_ms: now,
        app_user_id: realUserId,
        original_app_user_id: anonymousId,
        aliases: [anonymousId],
        environment: "SANDBOX" as const,
      };
      await t.mutation(api.webhooks.process, {
        event: {
          id: aliasPayload.id,
          type: aliasPayload.type,
          app_user_id: aliasPayload.app_user_id,
          environment: aliasPayload.environment,
        },
        payload: aliasPayload,
      });

      // billingIssueDetectedAt from the anonymous (source) record must be carried
      // over to the real user's entitlement, without it they'd lose grace-period access.
      const realEnts = await t.query(api.entitlements.list, {
        appUserId: realUserId,
      });
      expect(realEnts.length).toBe(1);
      expect(realEnts[0].billingIssueDetectedAt).toBeDefined();
    });

    test("preserves unsubscribeDetectedAt from source when both users have the same entitlement and source is newer", async () => {
      // No handler currently populates unsubscribeDetectedAt, so we seed it
      // directly via t.run to verify the aliasEntitlements patch carries it over.
      const t = initConvexTest();
      const anonymousId = "$RCAnonymousID:unsub_alias";
      const realUserId = "user_unsub_alias_real";
      const now = Date.now();

      // Real user: shorter expiry (older record).
      await t.run(async (ctx) =>
        ctx.db.insert("entitlements", {
          appUserId: realUserId,
          entitlementId: "premium",
          isActive: true,
          isSandbox: false,
          expiresAtMs: now + 10 * 24 * 60 * 60 * 1000,
          updatedAt: now,
        }),
      );

      // Anonymous user: longer expiry (newer record).
      const anonEntId = await t.run(async (ctx) =>
        ctx.db.insert("entitlements", {
          appUserId: anonymousId,
          entitlementId: "premium",
          isActive: true,
          isSandbox: false,
          expiresAtMs: now + 30 * 24 * 60 * 60 * 1000,
          updatedAt: now,
        }),
      );

      // Seed unsubscribeDetectedAt directly, no handler sets this yet
      const unsubscribeTs = now - 500;
      await t.run(async (ctx) => {
        await ctx.db.patch(anonEntId, { unsubscribeDetectedAt: unsubscribeTs });
      });

      // Confirm state before alias: anon has it, real doesn't
      const anonEnts = await t.query(api.entitlements.list, {
        appUserId: anonymousId,
      });
      expect(anonEnts[0].unsubscribeDetectedAt).toBe(unsubscribeTs);
      const realEntsBefore = await t.query(api.entitlements.list, {
        appUserId: realUserId,
      });
      expect(realEntsBefore[0].unsubscribeDetectedAt).toBeUndefined();

      // SUBSCRIBER_ALIAS: anon (newer) → real (existing, older)
      const aliasPayload = {
        id: "evt_unsub_alias_merge",
        type: "SUBSCRIBER_ALIAS",
        event_timestamp_ms: now,
        app_user_id: realUserId,
        original_app_user_id: anonymousId,
        aliases: [anonymousId],
        environment: "SANDBOX" as const,
      };
      await t.mutation(api.webhooks.process, {
        event: {
          id: aliasPayload.id,
          type: aliasPayload.type,
          app_user_id: aliasPayload.app_user_id,
          environment: aliasPayload.environment,
        },
        payload: aliasPayload,
      });

      // unsubscribeDetectedAt from source must survive the merge
      const realEnts = await t.query(api.entitlements.list, {
        appUserId: realUserId,
      });
      expect(realEnts.length).toBe(1);
      expect(realEnts[0].unsubscribeDetectedAt).toBe(unsubscribeTs);
    });
  });

  describe("REFUND", () => {
    test("revokes entitlements when refund is issued", async () => {
      const t = initConvexTest();
      const futureExpiration = Date.now() + 30 * 24 * 60 * 60 * 1000;

      // User purchases
      const purchasePayload = createEventPayload({
        id: "evt_refund_purchase",
        type: "INITIAL_PURCHASE",
        app_user_id: "user_refund_1",
        expiration_at_ms: futureExpiration,
      });
      await t.mutation(api.webhooks.process, {
        event: {
          id: purchasePayload.id,
          type: purchasePayload.type,
          app_id: purchasePayload.app_id,
          app_user_id: purchasePayload.app_user_id,
          environment: purchasePayload.environment,
          store: purchasePayload.store,
        },
        payload: purchasePayload,
      });

      expect(
        await t.query(api.entitlements.check, {
          appUserId: "user_refund_1",
          entitlementId: "premium",
        }),
      ).toBe(true);

      // Refund issued, should revoke entitlement immediately
      const refundPayload = createEventPayload({
        id: "evt_refund_issued",
        type: "REFUND",
        app_user_id: "user_refund_1",
        expiration_at_ms: Date.now() - 1000,
        expiration_reason: "CUSTOMER_SUPPORT",
      });
      await t.mutation(api.webhooks.process, {
        event: {
          id: refundPayload.id,
          type: refundPayload.type,
          app_id: refundPayload.app_id,
          app_user_id: refundPayload.app_user_id,
          environment: refundPayload.environment,
          store: refundPayload.store,
        },
        payload: refundPayload,
      });

      expect(
        await t.query(api.entitlements.check, {
          appUserId: "user_refund_1",
          entitlementId: "premium",
        }),
      ).toBe(false);
    });

    test("does not revoke unrelated entitlements when entitlement_ids is absent on REFUND", async () => {
      const t = initConvexTest();

      // Grant two entitlements
      const purchasePayload = createEventPayload({
        id: "evt_refund_multi_purchase",
        type: "INITIAL_PURCHASE",
        app_user_id: "user_refund_multi",
        entitlement_ids: ["premium"],
        expiration_at_ms: Date.now() + 30 * 24 * 60 * 60 * 1000,
      });
      await t.mutation(api.webhooks.process, {
        event: {
          id: purchasePayload.id,
          type: purchasePayload.type,
          app_user_id: purchasePayload.app_user_id,
          environment: purchasePayload.environment,
          store: purchasePayload.store,
        },
        payload: purchasePayload,
      });

      // Refund with no entitlement_ids (product not mapped), should not revoke anything
      const refundPayload = {
        ...createEventPayload({
          id: "evt_refund_no_ents",
          type: "REFUND",
          app_user_id: "user_refund_multi",
          expiration_at_ms: Date.now() - 1000,
        }),
        entitlement_ids: undefined,
      };
      await t.mutation(api.webhooks.process, {
        event: {
          id: refundPayload.id,
          type: refundPayload.type,
          app_user_id: refundPayload.app_user_id,
          environment: refundPayload.environment,
          store: refundPayload.store,
        },
        payload: refundPayload,
      });

      // Entitlement should still be active, unmapped product refund shouldn't revoke
      expect(
        await t.query(api.entitlements.check, {
          appUserId: "user_refund_multi",
          entitlementId: "premium",
        }),
      ).toBe(true);
    });
  });

  describe("webhook reconciliation with sync-created records", () => {
    test("webhook updates sync-created subscription by (appUserId, productId) fallback", async () => {
      const t = initConvexTest();

      // Sync creates a subscription (no originalTransactionId from webhook)
      await t.mutation(api.sync.ingest, {
        appUserId: "user_reconcile",
        subscriber: {
          first_seen: "2024-01-01T00:00:00Z",
          entitlements: {
            premium: {
              expires_date: new Date(Date.now() + 30 * 86400000).toISOString(),
              product_identifier: "premium_monthly",
              purchase_date: "2024-01-01T00:00:00Z",
            },
          },
          subscriptions: {
            premium_monthly: {
              store: "APP_STORE",
              is_sandbox: false,
              period_type: "normal",
              expires_date: new Date(Date.now() + 30 * 86400000).toISOString(),
              purchase_date: "2024-01-01T00:00:00Z",
              original_purchase_date: "2024-01-01T00:00:00Z",
              store_transaction_id: "txn_sync_123",
            },
          },
        },
      });

      // Verify sync created 1 subscription
      const subsBefore = await t.query(api.subscriptions.getByUser, {
        appUserId: "user_reconcile",
      });
      expect(subsBefore).toHaveLength(1);
      expect(subsBefore[0].originalTransactionId).toBe("txn_sync_123");

      // Webhook arrives with the real originalTransactionId
      const payload = createEventPayload({
        id: "evt_reconcile_1",
        type: "RENEWAL",
        app_user_id: "user_reconcile",
        product_id: "premium_monthly",
        entitlement_ids: ["premium"],
        expiration_at_ms: Date.now() + 60 * 86400000,
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

      // Should still be 1 subscription (not 2), with the webhook's originalTransactionId
      const subsAfter = await t.query(api.subscriptions.getByUser, {
        appUserId: "user_reconcile",
      });
      expect(subsAfter).toHaveLength(1);
      expect(subsAfter[0].originalTransactionId).toBe(
        payload.original_transaction_id,
      );
    });
  });
});
