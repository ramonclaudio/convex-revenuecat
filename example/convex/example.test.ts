import { describe, expect, test } from "vitest";
import { initConvexTest } from "./setup.test";
import { api, components } from "./_generated/api";

function createEventPayload(
  overrides: Partial<{
    type: string;
    id: string;
    app_user_id: string;
    entitlement_ids: string[];
    product_id: string;
    expiration_at_ms: number;
    original_transaction_id: string;
    transaction_id: string;
  }> = {},
) {
  const now = Date.now();
  return {
    type: overrides.type ?? "INITIAL_PURCHASE",
    id: overrides.id ?? `evt_${now}`,
    app_id: "app_123",
    app_user_id: overrides.app_user_id ?? "user_123",
    original_app_user_id: overrides.app_user_id ?? "user_123",
    aliases: [],
    event_timestamp_ms: now,
    product_id: overrides.product_id ?? "premium_monthly",
    entitlement_ids: overrides.entitlement_ids ?? ["premium"],
    period_type: "NORMAL" as const,
    purchased_at_ms: now,
    expiration_at_ms: overrides.expiration_at_ms ?? now + 30 * 24 * 60 * 60 * 1000,
    transaction_id: overrides.transaction_id ?? `txn_${now}`,
    original_transaction_id: overrides.original_transaction_id ?? `txn_original_${now}`,
    store: "APP_STORE" as const,
    environment: "SANDBOX" as const,
    is_family_share: false,
  };
}

async function processEvent(
  t: ReturnType<typeof initConvexTest>,
  payload: ReturnType<typeof createEventPayload>,
) {
  await t.mutation(components.revenuecat.webhooks.process, {
    event: {
      id: payload.id,
      type: payload.type,
      app_user_id: payload.app_user_id,
      environment: payload.environment,
      store: payload.store,
    },
    payload,
  });
}

describe("subscriptions", () => {
  describe("checkPremium", () => {
    test("returns false when no entitlement", async () => {
      const t = initConvexTest();

      const result = await t.query(api.subscriptions.checkPremium, {
        appUserId: "user_no_premium",
      });

      expect(result).toBe(false);
    });

    test("returns true when premium entitlement exists", async () => {
      const t = initConvexTest();

      const payload = createEventPayload({
        id: "evt_example_1",
        app_user_id: "user_example_1",
        entitlement_ids: ["premium"],
      });

      await processEvent(t, payload);

      const result = await t.query(api.subscriptions.checkPremium, {
        appUserId: "user_example_1",
      });

      expect(result).toBe(true);
    });
  });

  describe("getActiveEntitlements", () => {
    test("returns active entitlements", async () => {
      const t = initConvexTest();

      const payload = createEventPayload({
        id: "evt_example_2",
        app_user_id: "user_example_2",
        entitlement_ids: ["premium", "pro"],
      });

      await processEvent(t, payload);

      const result = await t.query(api.subscriptions.getActiveEntitlements, {
        appUserId: "user_example_2",
      });

      expect(result.length).toBe(2);
    });
  });

  describe("getAllEntitlements", () => {
    test("returns all entitlements including expired", async () => {
      const t = initConvexTest();
      const userId = "user_all_entitlements";

      // Active entitlement
      await processEvent(
        t,
        createEventPayload({
          id: "evt_active",
          app_user_id: userId,
          entitlement_ids: ["premium"],
          original_transaction_id: "txn_orig_1",
          transaction_id: "txn_1",
        }),
      );

      // Expired entitlement
      await processEvent(
        t,
        createEventPayload({
          id: "evt_expired",
          type: "EXPIRATION",
          app_user_id: userId,
          entitlement_ids: ["pro"],
          expiration_at_ms: Date.now() - 1000,
          original_transaction_id: "txn_orig_2",
          transaction_id: "txn_2",
        }),
      );

      const all = await t.query(api.subscriptions.getAllEntitlements, { appUserId: userId });
      const active = await t.query(api.subscriptions.getActiveEntitlements, { appUserId: userId });

      expect(all.length).toBeGreaterThanOrEqual(active.length);
    });
  });

  describe("getAllSubscriptions", () => {
    test("returns all subscriptions", async () => {
      const t = initConvexTest();
      const userId = "user_all_subs";

      await processEvent(
        t,
        createEventPayload({
          id: "evt_sub_1",
          app_user_id: userId,
          product_id: "monthly",
          original_transaction_id: "txn_orig_sub_1",
          transaction_id: "txn_sub_1",
        }),
      );

      await processEvent(
        t,
        createEventPayload({
          id: "evt_sub_2",
          app_user_id: userId,
          product_id: "yearly",
          original_transaction_id: "txn_orig_sub_2",
          transaction_id: "txn_sub_2",
        }),
      );

      const result = await t.query(api.subscriptions.getAllSubscriptions, { appUserId: userId });

      expect(result.length).toBe(2);
    });
  });

  describe("getCustomer", () => {
    test("returns customer after webhook", async () => {
      const t = initConvexTest();
      const userId = "user_customer";

      await processEvent(
        t,
        createEventPayload({
          id: "evt_customer",
          app_user_id: userId,
        }),
      );

      const result = await t.query(api.subscriptions.getCustomer, { appUserId: userId });

      expect(result).not.toBeNull();
      expect(result?.appUserId).toBe(userId);
    });

    test("returns null for unknown user", async () => {
      const t = initConvexTest();

      const result = await t.query(api.subscriptions.getCustomer, { appUserId: "unknown_user" });

      expect(result).toBeNull();
    });
  });

  describe("getExperiment", () => {
    test("returns experiment for user", async () => {
      const t = initConvexTest();
      const userId = "user_experiment";
      const experimentId = "pricing_test";

      await t.mutation(components.revenuecat.webhooks.process, {
        event: {
          id: "evt_exp_1",
          type: "EXPERIMENT_ENROLLMENT",
          app_user_id: userId,
          environment: "SANDBOX" as const,
        },
        payload: {
          type: "EXPERIMENT_ENROLLMENT",
          id: "evt_exp_1",
          app_user_id: userId,
          original_app_user_id: userId,
          event_timestamp_ms: Date.now(),
          experiment_id: experimentId,
          experiment_variant: "variant_b",
          offering_id: "offering_premium",
          experiment_enrolled_at_ms: Date.now(),
          environment: "SANDBOX",
        },
      });

      const result = await t.query(api.subscriptions.getExperiment, {
        appUserId: userId,
        experimentId,
      });

      expect(result).not.toBeNull();
      expect(result?.variant).toBe("variant_b");
      expect(result?.offeringId).toBe("offering_premium");
    });

    test("returns null for unknown experiment", async () => {
      const t = initConvexTest();

      const result = await t.query(api.subscriptions.getExperiment, {
        appUserId: "user_unknown",
        experimentId: "unknown_exp",
      });

      expect(result).toBeNull();
    });
  });

  describe("getExperiments", () => {
    test("returns all experiments for user", async () => {
      const t = initConvexTest();
      const userId = "user_multi_exp";

      for (const [i, expId] of ["exp_1", "exp_2"].entries()) {
        await t.mutation(components.revenuecat.webhooks.process, {
          event: {
            id: `evt_multi_${i}`,
            type: "EXPERIMENT_ENROLLMENT",
            app_user_id: userId,
            environment: "SANDBOX" as const,
          },
          payload: {
            type: "EXPERIMENT_ENROLLMENT",
            id: `evt_multi_${i}`,
            app_user_id: userId,
            original_app_user_id: userId,
            event_timestamp_ms: Date.now(),
            experiment_id: expId,
            experiment_variant: "control",
            environment: "SANDBOX",
          },
        });
      }

      const result = await t.query(api.subscriptions.getExperiments, { appUserId: userId });

      expect(result.length).toBe(2);
    });
  });
});
