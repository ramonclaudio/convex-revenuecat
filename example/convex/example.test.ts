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
    expiration_at_ms:
      overrides.expiration_at_ms ?? now + 30 * 24 * 60 * 60 * 1000,
    transaction_id: overrides.transaction_id ?? `txn_${now}`,
    original_transaction_id:
      overrides.original_transaction_id ?? `txn_original_${now}`,
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

function asUser(t: ReturnType<typeof initConvexTest>, subject: string) {
  return t.withIdentity({ subject });
}

describe("subscriptions", () => {
  describe("checkPremium", () => {
    test("rejects unauthenticated callers", async () => {
      const t = initConvexTest();
      await expect(t.query(api.subscriptions.checkPremium, {})).rejects.toThrow(
        /Not authenticated/,
      );
    });

    test("returns false when no entitlement", async () => {
      const t = initConvexTest();
      const result = await asUser(t, "user_no_premium").query(
        api.subscriptions.checkPremium,
        {},
      );
      expect(result).toBe(false);
    });

    test("returns true when premium entitlement exists", async () => {
      const t = initConvexTest();
      const subject = "user_example_1";

      await processEvent(
        t,
        createEventPayload({
          id: "evt_example_1",
          app_user_id: subject,
          entitlement_ids: ["premium"],
        }),
      );

      const result = await asUser(t, subject).query(
        api.subscriptions.checkPremium,
        {},
      );
      expect(result).toBe(true);
    });
  });

  describe("getActiveEntitlements", () => {
    test("returns active entitlements", async () => {
      const t = initConvexTest();
      const subject = "user_example_2";

      await processEvent(
        t,
        createEventPayload({
          id: "evt_example_2",
          app_user_id: subject,
          entitlement_ids: ["premium", "pro"],
        }),
      );

      const result = await asUser(t, subject).query(
        api.subscriptions.getActiveEntitlements,
        {},
      );
      expect(result.length).toBe(2);
    });
  });

  describe("getAllEntitlements", () => {
    test("returns all entitlements including expired", async () => {
      const t = initConvexTest();
      const subject = "user_all_entitlements";

      await processEvent(
        t,
        createEventPayload({
          id: "evt_active",
          app_user_id: subject,
          entitlement_ids: ["premium"],
          original_transaction_id: "txn_orig_1",
          transaction_id: "txn_1",
        }),
      );

      await processEvent(
        t,
        createEventPayload({
          id: "evt_expired",
          type: "EXPIRATION",
          app_user_id: subject,
          entitlement_ids: ["pro"],
          expiration_at_ms: Date.now() - 1000,
          original_transaction_id: "txn_orig_2",
          transaction_id: "txn_2",
        }),
      );

      const all = await asUser(t, subject).query(
        api.subscriptions.getAllEntitlements,
        {},
      );
      const active = await asUser(t, subject).query(
        api.subscriptions.getActiveEntitlements,
        {},
      );

      expect(all.length).toBeGreaterThanOrEqual(active.length);
    });
  });

  describe("getAllSubscriptions", () => {
    test("returns all subscriptions", async () => {
      const t = initConvexTest();
      const subject = "user_all_subs";

      await processEvent(
        t,
        createEventPayload({
          id: "evt_sub_1",
          app_user_id: subject,
          product_id: "monthly",
          original_transaction_id: "txn_orig_sub_1",
          transaction_id: "txn_sub_1",
        }),
      );

      await processEvent(
        t,
        createEventPayload({
          id: "evt_sub_2",
          app_user_id: subject,
          product_id: "yearly",
          original_transaction_id: "txn_orig_sub_2",
          transaction_id: "txn_sub_2",
        }),
      );

      const result = await asUser(t, subject).query(
        api.subscriptions.getAllSubscriptions,
        {},
      );
      expect(result.length).toBe(2);
    });
  });

  describe("getCustomer", () => {
    test("returns customer after webhook", async () => {
      const t = initConvexTest();
      const subject = "user_customer";

      await processEvent(
        t,
        createEventPayload({
          id: "evt_customer",
          app_user_id: subject,
        }),
      );

      const result = await asUser(t, subject).query(
        api.subscriptions.getCustomer,
        {},
      );

      expect(result).not.toBeNull();
      expect(result?.appUserId).toBe(subject);
    });

    test("returns null for unknown user", async () => {
      const t = initConvexTest();
      const result = await asUser(t, "unknown_user").query(
        api.subscriptions.getCustomer,
        {},
      );
      expect(result).toBeNull();
    });
  });

  describe("getExperiment", () => {
    test("returns experiment for user", async () => {
      const t = initConvexTest();
      const subject = "user_experiment";
      const experimentId = "pricing_test";

      await t.mutation(components.revenuecat.webhooks.process, {
        event: {
          id: "evt_exp_1",
          type: "EXPERIMENT_ENROLLMENT",
          app_user_id: subject,
          environment: "SANDBOX" as const,
        },
        payload: {
          type: "EXPERIMENT_ENROLLMENT",
          id: "evt_exp_1",
          app_user_id: subject,
          original_app_user_id: subject,
          event_timestamp_ms: Date.now(),
          experiment_id: experimentId,
          experiment_variant: "variant_b",
          offering_id: "offering_premium",
          experiment_enrolled_at_ms: Date.now(),
          environment: "SANDBOX",
        },
      });

      const result = await asUser(t, subject).query(
        api.subscriptions.getExperiment,
        {
          experimentId,
        },
      );

      expect(result).not.toBeNull();
      expect(result?.variant).toBe("variant_b");
      expect(result?.offeringId).toBe("offering_premium");
    });

    test("returns null for unknown experiment", async () => {
      const t = initConvexTest();
      const result = await asUser(t, "user_unknown").query(
        api.subscriptions.getExperiment,
        { experimentId: "unknown_exp" },
      );
      expect(result).toBeNull();
    });
  });

  describe("getExperiments", () => {
    test("returns all experiments for user", async () => {
      const t = initConvexTest();
      const subject = "user_multi_exp";

      for (const [i, expId] of ["exp_1", "exp_2"].entries()) {
        await t.mutation(components.revenuecat.webhooks.process, {
          event: {
            id: `evt_multi_${i}`,
            type: "EXPERIMENT_ENROLLMENT",
            app_user_id: subject,
            environment: "SANDBOX" as const,
          },
          payload: {
            type: "EXPERIMENT_ENROLLMENT",
            id: `evt_multi_${i}`,
            app_user_id: subject,
            original_app_user_id: subject,
            event_timestamp_ms: Date.now(),
            experiment_id: expId,
            experiment_variant: "control",
            environment: "SANDBOX",
          },
        });
      }

      const result = await asUser(t, subject).query(
        api.subscriptions.getExperiments,
        {},
      );
      expect(result.length).toBe(2);
    });
  });

  describe("cross-user isolation", () => {
    test("does not leak another user's entitlements (IDOR)", async () => {
      const t = initConvexTest();
      await processEvent(
        t,
        createEventPayload({
          id: "evt_idor",
          app_user_id: "user_a",
          entitlement_ids: ["premium"],
        }),
      );

      expect(
        await asUser(t, "user_b").query(api.subscriptions.checkPremium, {}),
      ).toBe(false);
      expect(
        (
          await asUser(t, "user_b").query(
            api.subscriptions.getActiveEntitlements,
            {},
          )
        ).length,
      ).toBe(0);

      expect(
        await asUser(t, "user_a").query(api.subscriptions.checkPremium, {}),
      ).toBe(true);
    });
  });
});
