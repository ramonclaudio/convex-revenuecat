import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api.js";
import { initConvexTest } from "./setup.test.js";

function basePayload(
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
    grace_period_expiration_at_ms: number;
    transferred_from: string[];
    transferred_to: string[];
    new_product_id: string;
    original_transaction_id: string;
    transaction_id: string;
    period_type: "TRIAL" | "INTRO" | "NORMAL" | "PROMOTIONAL" | "PREPAID";
    store: "APP_STORE" | "PLAY_STORE" | "PROMOTIONAL" | "STRIPE";
    event_timestamp_ms: number;
  }> = {},
) {
  const now = Date.now();
  return {
    type: overrides.type ?? "RENEWAL",
    id: overrides.id ?? `evt_${now}`,
    app_id: "app_parity",
    app_user_id: overrides.app_user_id ?? "user_parity",
    original_app_user_id:
      overrides.original_app_user_id ?? overrides.app_user_id ?? "user_parity",
    aliases: [],
    event_timestamp_ms: overrides.event_timestamp_ms ?? now,
    product_id: overrides.product_id ?? "premium_monthly",
    entitlement_ids: overrides.entitlement_ids ?? ["premium"],
    period_type: overrides.period_type ?? ("NORMAL" as const),
    purchased_at_ms: now,
    expiration_at_ms:
      overrides.expiration_at_ms ?? now + 30 * 24 * 60 * 60 * 1000,
    transaction_id: overrides.transaction_id ?? `txn_${now}`,
    original_transaction_id: overrides.original_transaction_id ?? `otxn_${now}`,
    store: overrides.store ?? ("APP_STORE" as const),
    environment: "SANDBOX" as const,
    is_family_share: false,
    cancel_reason: overrides.cancel_reason,
    expiration_reason: overrides.expiration_reason,
    auto_resume_at_ms: overrides.auto_resume_at_ms,
    grace_period_expiration_at_ms: overrides.grace_period_expiration_at_ms,
    new_product_id: overrides.new_product_id,
    transferred_from: overrides.transferred_from,
    transferred_to: overrides.transferred_to,
  };
}

async function dispatch(
  t: ReturnType<typeof initConvexTest>,
  payload: ReturnType<typeof basePayload>,
) {
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
}

describe("parity fixes", () => {
  describe("expiresAtMs fallback on partial events", () => {
    test("RENEWAL without expiration_at_ms preserves prior entitlement expiry", async () => {
      const t = initConvexTest();
      const originalExpiry = Date.now() + 30 * 24 * 60 * 60 * 1000;

      await dispatch(
        t,
        basePayload({
          id: "evt_p1_init",
          type: "INITIAL_PURCHASE",
          app_user_id: "user_p1",
          expiration_at_ms: originalExpiry,
        }),
      );

      // RENEWAL with missing expiration_at_ms (malformed/partial payload)
      const partial = basePayload({
        id: "evt_p1_partial_renewal",
        type: "RENEWAL",
        app_user_id: "user_p1",
      });
      partial.expiration_at_ms = undefined as unknown as number;
      await dispatch(t, partial);

      const ents = await t.query(api.entitlements.list, {
        appUserId: "user_p1",
      });
      const premium = ents.find((e) => e.entitlementId === "premium")!;
      expect(premium.expiresAtMs).toBe(originalExpiry);
    });

    test("PRODUCT_CHANGE without expiration_at_ms preserves prior entitlement expiry", async () => {
      const t = initConvexTest();
      const originalExpiry = Date.now() + 30 * 24 * 60 * 60 * 1000;

      await dispatch(
        t,
        basePayload({
          id: "evt_p1_pc_init",
          type: "INITIAL_PURCHASE",
          app_user_id: "user_p1_pc",
          expiration_at_ms: originalExpiry,
        }),
      );

      const partial = basePayload({
        id: "evt_p1_pc_change",
        type: "PRODUCT_CHANGE",
        app_user_id: "user_p1_pc",
        new_product_id: "pro_yearly",
      });
      partial.expiration_at_ms = undefined as unknown as number;
      await dispatch(t, partial);

      const ents = await t.query(api.entitlements.list, {
        appUserId: "user_p1_pc",
      });
      expect(ents[0].expiresAtMs).toBe(originalExpiry);
    });
  });

  describe("processRenewal clears stale period-specific markers", () => {
    test("RENEWAL clears billingIssueDetectedAt, gracePeriod, newProductId, expirationReason, unsubscribeDetectedAt", async () => {
      const t = initConvexTest();
      const initialExpiry = Date.now() + 30 * 24 * 60 * 60 * 1000;
      const sharedTxn = "otxn_p2";

      await dispatch(
        t,
        basePayload({
          id: "evt_p2_init",
          type: "INITIAL_PURCHASE",
          app_user_id: "user_p2",
          expiration_at_ms: initialExpiry,
          original_transaction_id: sharedTxn,
          transaction_id: sharedTxn,
        }),
      );

      // BILLING_ISSUE sets billingIssueDetectedAt + grace
      await dispatch(
        t,
        basePayload({
          id: "evt_p2_billing",
          type: "BILLING_ISSUE",
          app_user_id: "user_p2",
          expiration_at_ms: initialExpiry,
          grace_period_expiration_at_ms:
            initialExpiry + 7 * 24 * 60 * 60 * 1000,
          original_transaction_id: sharedTxn,
          transaction_id: sharedTxn,
        }),
      );

      // CANCELLATION with UNSUBSCRIBE sets unsubscribeDetectedAt
      await dispatch(
        t,
        basePayload({
          id: "evt_p2_cancel",
          type: "CANCELLATION",
          app_user_id: "user_p2",
          expiration_at_ms: initialExpiry,
          cancel_reason: "UNSUBSCRIBE",
          original_transaction_id: sharedTxn,
          transaction_id: sharedTxn,
        }),
      );

      // PRODUCT_CHANGE sets newProductId
      await dispatch(
        t,
        basePayload({
          id: "evt_p2_pc",
          type: "PRODUCT_CHANGE",
          app_user_id: "user_p2",
          expiration_at_ms: initialExpiry,
          new_product_id: "pro_yearly",
          original_transaction_id: sharedTxn,
          transaction_id: sharedTxn,
        }),
      );

      let subs = await t.query(api.subscriptions.getByUser, {
        appUserId: "user_p2",
      });
      expect(subs[0].billingIssueDetectedAt).toBeDefined();
      expect(subs[0].gracePeriodExpirationAtMs).toBeDefined();
      expect(subs[0].unsubscribeDetectedAt).toBeDefined();
      expect(subs[0].newProductId).toBe("pro_yearly");

      // RENEWAL should clear every stale marker
      const nextExpiry = initialExpiry + 30 * 24 * 60 * 60 * 1000;
      await dispatch(
        t,
        basePayload({
          id: "evt_p2_renewal",
          type: "RENEWAL",
          app_user_id: "user_p2",
          expiration_at_ms: nextExpiry,
          original_transaction_id: sharedTxn,
          transaction_id: sharedTxn,
        }),
      );

      subs = await t.query(api.subscriptions.getByUser, {
        appUserId: "user_p2",
      });
      expect(subs[0].billingIssueDetectedAt).toBeUndefined();
      expect(subs[0].gracePeriodExpirationAtMs).toBeUndefined();
      expect(subs[0].unsubscribeDetectedAt).toBeUndefined();
      expect(subs[0].newProductId).toBeUndefined();
      expect(subs[0].expirationReason).toBeUndefined();
      expect(subs[0].autoRenewStatus).toBe(true);
      expect(subs[0].expirationAtMs).toBe(nextExpiry);
    });
  });

  describe("processExpiration clears stale state", () => {
    test("EXPIRATION clears autoResumeAtMs and gracePeriodExpirationAtMs", async () => {
      const t = initConvexTest();
      const initialExpiry = Date.now() + 30 * 24 * 60 * 60 * 1000;
      const sharedTxn = "otxn_p3";

      await dispatch(
        t,
        basePayload({
          id: "evt_p3_init",
          type: "INITIAL_PURCHASE",
          app_user_id: "user_p3",
          expiration_at_ms: initialExpiry,
          original_transaction_id: sharedTxn,
          transaction_id: sharedTxn,
        }),
      );

      // Pause marker
      await dispatch(
        t,
        basePayload({
          id: "evt_p3_pause",
          type: "SUBSCRIPTION_PAUSED",
          app_user_id: "user_p3",
          expiration_at_ms: initialExpiry,
          auto_resume_at_ms: initialExpiry + 14 * 24 * 60 * 60 * 1000,
          original_transaction_id: sharedTxn,
          transaction_id: sharedTxn,
        }),
      );

      // Billing issue (grace)
      await dispatch(
        t,
        basePayload({
          id: "evt_p3_billing",
          type: "BILLING_ISSUE",
          app_user_id: "user_p3",
          expiration_at_ms: initialExpiry,
          grace_period_expiration_at_ms:
            initialExpiry + 7 * 24 * 60 * 60 * 1000,
          original_transaction_id: sharedTxn,
          transaction_id: sharedTxn,
        }),
      );

      let subs = await t.query(api.subscriptions.getByUser, {
        appUserId: "user_p3",
      });
      expect(subs[0].autoResumeAtMs).toBeDefined();
      expect(subs[0].gracePeriodExpirationAtMs).toBeDefined();

      await dispatch(
        t,
        basePayload({
          id: "evt_p3_expire",
          type: "EXPIRATION",
          app_user_id: "user_p3",
          expiration_at_ms: initialExpiry,
          expiration_reason: "BILLING_ERROR",
          original_transaction_id: sharedTxn,
          transaction_id: sharedTxn,
        }),
      );

      subs = await t.query(api.subscriptions.getByUser, {
        appUserId: "user_p3",
      });
      expect(subs[0].autoResumeAtMs).toBeUndefined();
      expect(subs[0].gracePeriodExpirationAtMs).toBeUndefined();
      expect(subs[0].autoRenewStatus).toBe(false);
    });
  });

  describe("CANCELLATION with BILLING_ERROR sets billingIssueDetectedAt", () => {
    test("coherent with BILLING_ISSUE event state", async () => {
      const t = initConvexTest();
      const expiry = Date.now() + 30 * 24 * 60 * 60 * 1000;
      const sharedTxn = "otxn_p4";

      await dispatch(
        t,
        basePayload({
          id: "evt_p4_init",
          type: "INITIAL_PURCHASE",
          app_user_id: "user_p4",
          expiration_at_ms: expiry,
          original_transaction_id: sharedTxn,
          transaction_id: sharedTxn,
        }),
      );

      await dispatch(
        t,
        basePayload({
          id: "evt_p4_cancel",
          type: "CANCELLATION",
          app_user_id: "user_p4",
          expiration_at_ms: expiry,
          cancel_reason: "BILLING_ERROR",
          original_transaction_id: sharedTxn,
          transaction_id: sharedTxn,
        }),
      );

      const subs = await t.query(api.subscriptions.getByUser, {
        appUserId: "user_p4",
      });
      expect(subs[0].billingIssueDetectedAt).toBeDefined();
      expect(subs[0].cancelReason).toBe("BILLING_ERROR");
      expect(subs[0].autoRenewStatus).toBe(false);
    });
  });

  describe("BILLING_ISSUE sets autoRenewStatus false", () => {
    test("derived willRenew flips false while billing retry is active", async () => {
      const t = initConvexTest();
      const expiry = Date.now() + 30 * 24 * 60 * 60 * 1000;
      const sharedTxn = "otxn_p5";

      await dispatch(
        t,
        basePayload({
          id: "evt_p5_init",
          type: "INITIAL_PURCHASE",
          app_user_id: "user_p5",
          expiration_at_ms: expiry,
          original_transaction_id: sharedTxn,
          transaction_id: sharedTxn,
        }),
      );
      let subs = await t.query(api.subscriptions.getByUser, {
        appUserId: "user_p5",
      });
      expect(subs[0].autoRenewStatus).toBe(true);

      await dispatch(
        t,
        basePayload({
          id: "evt_p5_billing",
          type: "BILLING_ISSUE",
          app_user_id: "user_p5",
          expiration_at_ms: expiry,
          grace_period_expiration_at_ms: expiry + 7 * 24 * 60 * 60 * 1000,
          original_transaction_id: sharedTxn,
          transaction_id: sharedTxn,
        }),
      );

      subs = await t.query(api.subscriptions.getByUser, {
        appUserId: "user_p5",
      });
      expect(subs[0].autoRenewStatus).toBe(false);
      expect(subs[0].billingIssueDetectedAt).toBeDefined();
    });
  });

  describe("willRenew drift: PREPAID / PROMOTIONAL / lifetime", () => {
    test("PREPAID sub stores autoRenewStatus false", async () => {
      const t = initConvexTest();
      await dispatch(
        t,
        basePayload({
          id: "evt_p6_prepaid",
          type: "INITIAL_PURCHASE",
          app_user_id: "user_p6_prepaid",
          period_type: "PREPAID",
        }),
      );
      const subs = await t.query(api.subscriptions.getByUser, {
        appUserId: "user_p6_prepaid",
      });
      expect(subs[0].autoRenewStatus).toBe(false);
    });

    test("PROMOTIONAL store stores autoRenewStatus false", async () => {
      const t = initConvexTest();
      await dispatch(
        t,
        basePayload({
          id: "evt_p6_promo",
          type: "INITIAL_PURCHASE",
          app_user_id: "user_p6_promo",
          store: "PROMOTIONAL",
        }),
      );
      const subs = await t.query(api.subscriptions.getByUser, {
        appUserId: "user_p6_promo",
      });
      expect(subs[0].autoRenewStatus).toBe(false);
    });

    test("lifetime (no expiration) stores autoRenewStatus false", async () => {
      const t = initConvexTest();
      const payload = basePayload({
        id: "evt_p6_lifetime",
        type: "NON_RENEWING_PURCHASE",
        app_user_id: "user_p6_lifetime",
      });
      payload.expiration_at_ms = undefined as unknown as number;
      await dispatch(t, payload);
      const subs = await t.query(api.subscriptions.getByUser, {
        appUserId: "user_p6_lifetime",
      });
      expect(subs[0].autoRenewStatus).toBe(false);
    });
  });

  describe("isInGracePeriod without normalExpired clause", () => {
    test("pre-expiry billing retry window returns inGracePeriod true", async () => {
      const t = initConvexTest();
      const expiry = Date.now() + 14 * 24 * 60 * 60 * 1000;
      const graceEnd = expiry + 7 * 24 * 60 * 60 * 1000;
      const sharedTxn = "otxn_p7";

      await dispatch(
        t,
        basePayload({
          id: "evt_p7_init",
          type: "INITIAL_PURCHASE",
          app_user_id: "user_p7",
          expiration_at_ms: expiry,
          original_transaction_id: sharedTxn,
          transaction_id: sharedTxn,
        }),
      );

      // BILLING_ISSUE fires BEFORE expiration_at_ms (Google Play pattern)
      await dispatch(
        t,
        basePayload({
          id: "evt_p7_billing",
          type: "BILLING_ISSUE",
          app_user_id: "user_p7",
          expiration_at_ms: expiry,
          grace_period_expiration_at_ms: graceEnd,
          original_transaction_id: sharedTxn,
          transaction_id: sharedTxn,
        }),
      );

      const status = await t.query(api.subscriptions.isInGracePeriod, {
        originalTransactionId: sharedTxn,
      });
      expect(status.inGracePeriod).toBe(true);

      const inGrace = await t.query(api.subscriptions.getInGracePeriod, {
        appUserId: "user_p7",
      });
      expect(inGrace).toHaveLength(1);
      expect(inGrace[0].originalTransactionId).toBe(sharedTxn);
    });
  });

  describe("transferEntitlements sourceIsNewer guard", () => {
    test("out-of-order TRANSFER doesn't regress destination's newer expiry", async () => {
      const t = initConvexTest();
      const oldExpiry = Date.now() + 10 * 24 * 60 * 60 * 1000;
      const newExpiry = Date.now() + 30 * 24 * 60 * 60 * 1000;

      // Source has an older-expiry entitlement
      await dispatch(
        t,
        basePayload({
          id: "evt_p8_src",
          type: "INITIAL_PURCHASE",
          app_user_id: "user_p8_src",
          expiration_at_ms: oldExpiry,
          original_transaction_id: "otxn_p8_src",
          transaction_id: "otxn_p8_src",
        }),
      );

      // Destination already has a fresh RENEWAL with newer expiry on the same entitlement
      await dispatch(
        t,
        basePayload({
          id: "evt_p8_dst",
          type: "INITIAL_PURCHASE",
          app_user_id: "user_p8_dst",
          expiration_at_ms: newExpiry,
          original_transaction_id: "otxn_p8_dst",
          transaction_id: "otxn_p8_dst",
        }),
      );

      await t.mutation(internal.handlers.processTransfer, {
        event: {
          type: "TRANSFER",
          id: "evt_p8_transfer",
          app_id: "app_parity",
          app_user_id: "user_p8_dst",
          aliases: [],
          event_timestamp_ms: Date.now(),
          environment: "SANDBOX",
          transferred_from: ["user_p8_src"],
          transferred_to: ["user_p8_dst"],
          entitlement_ids: ["premium"],
        },
      });

      const ents = await t.query(api.entitlements.list, {
        appUserId: "user_p8_dst",
      });
      const premium = ents.find((e) => e.entitlementId === "premium")!;
      expect(premium.expiresAtMs).toBe(newExpiry);
    });

    test("TRANSFER uses source expiry when destination is older", async () => {
      const t = initConvexTest();
      const oldExpiry = Date.now() + 10 * 24 * 60 * 60 * 1000;
      const newExpiry = Date.now() + 30 * 24 * 60 * 60 * 1000;

      await dispatch(
        t,
        basePayload({
          id: "evt_p8b_dst",
          type: "INITIAL_PURCHASE",
          app_user_id: "user_p8b_dst",
          expiration_at_ms: oldExpiry,
          original_transaction_id: "otxn_p8b_dst",
          transaction_id: "otxn_p8b_dst",
        }),
      );
      await dispatch(
        t,
        basePayload({
          id: "evt_p8b_src",
          type: "INITIAL_PURCHASE",
          app_user_id: "user_p8b_src",
          expiration_at_ms: newExpiry,
          original_transaction_id: "otxn_p8b_src",
          transaction_id: "otxn_p8b_src",
        }),
      );

      await t.mutation(internal.handlers.processTransfer, {
        event: {
          type: "TRANSFER",
          id: "evt_p8b_transfer",
          app_id: "app_parity",
          app_user_id: "user_p8b_dst",
          aliases: [],
          event_timestamp_ms: Date.now(),
          environment: "SANDBOX",
          transferred_from: ["user_p8b_src"],
          transferred_to: ["user_p8b_dst"],
          entitlement_ids: ["premium"],
        },
      });

      const ents = await t.query(api.entitlements.list, {
        appUserId: "user_p8b_dst",
      });
      const premium = ents.find((e) => e.entitlementId === "premium")!;
      expect(premium.expiresAtMs).toBe(newExpiry);
    });
  });

  describe("anonymous customer cleanup", () => {
    test("TRANSFER from $RCAnonymousID: deletes the source customer row", async () => {
      const t = initConvexTest();
      const anonId = "$RCAnonymousID:abcdef12345";
      const expiry = Date.now() + 30 * 24 * 60 * 60 * 1000;

      await dispatch(
        t,
        basePayload({
          id: "evt_p9_anon_init",
          type: "INITIAL_PURCHASE",
          app_user_id: anonId,
          expiration_at_ms: expiry,
          original_transaction_id: "otxn_p9_anon",
          transaction_id: "otxn_p9_anon",
        }),
      );

      const beforeCustomer = await t.query(api.customers.get, {
        appUserId: anonId,
      });
      expect(beforeCustomer).not.toBeNull();

      await t.mutation(internal.handlers.processTransfer, {
        event: {
          type: "TRANSFER",
          id: "evt_p9_transfer",
          app_id: "app_parity",
          app_user_id: "user_p9_real",
          aliases: [],
          event_timestamp_ms: Date.now(),
          environment: "SANDBOX",
          transferred_from: [anonId],
          transferred_to: ["user_p9_real"],
        },
      });

      const afterCustomer = await t.query(api.customers.get, {
        appUserId: anonId,
      });
      expect(afterCustomer).toBeNull();

      // Destination retains the data
      const destEnts = await t.query(api.entitlements.list, {
        appUserId: "user_p9_real",
      });
      expect(destEnts).toHaveLength(1);
    });

    test("SUBSCRIBER_ALIAS from anonymous ID deletes the source customer row", async () => {
      const t = initConvexTest();
      const anonId = "$RCAnonymousID:legacy123";

      await dispatch(
        t,
        basePayload({
          id: "evt_p9_alias_init",
          type: "INITIAL_PURCHASE",
          app_user_id: anonId,
          original_transaction_id: "otxn_p9_alias",
          transaction_id: "otxn_p9_alias",
        }),
      );

      await t.mutation(internal.handlers.processSubscriberAlias, {
        event: {
          type: "SUBSCRIBER_ALIAS",
          id: "evt_p9_alias",
          app_id: "app_parity",
          app_user_id: "user_p9_canonical",
          original_app_user_id: anonId,
          aliases: [],
          event_timestamp_ms: Date.now(),
          environment: "SANDBOX",
        },
      });

      const afterCustomer = await t.query(api.customers.get, {
        appUserId: anonId,
      });
      expect(afterCustomer).toBeNull();
    });

    test("TRANSFER preserves the source customer row when it's NOT anonymous", async () => {
      const t = initConvexTest();
      const realId = "user_p9_persistent";

      await dispatch(
        t,
        basePayload({
          id: "evt_p9_persist_init",
          type: "INITIAL_PURCHASE",
          app_user_id: realId,
          original_transaction_id: "otxn_p9_persist",
          transaction_id: "otxn_p9_persist",
        }),
      );

      await t.mutation(internal.handlers.processTransfer, {
        event: {
          type: "TRANSFER",
          id: "evt_p9_persist_transfer",
          app_id: "app_parity",
          app_user_id: "user_p9_target",
          aliases: [],
          event_timestamp_ms: Date.now(),
          environment: "SANDBOX",
          transferred_from: [realId],
          transferred_to: ["user_p9_target"],
        },
      });

      const persistCustomer = await t.query(api.customers.get, {
        appUserId: realId,
      });
      expect(persistCustomer).not.toBeNull();
    });
  });

  describe("transferSubscriptions dedup on originalTransactionId", () => {
    test("retried TRANSFER doesn't duplicate subs when dest already has the row", async () => {
      const t = initConvexTest();
      const sharedTxn = "otxn_p10_shared";
      const expiry = Date.now() + 30 * 24 * 60 * 60 * 1000;

      // Source has a sub with `sharedTxn`
      await dispatch(
        t,
        basePayload({
          id: "evt_p10_src",
          type: "INITIAL_PURCHASE",
          app_user_id: "user_p10_src",
          expiration_at_ms: expiry,
          original_transaction_id: sharedTxn,
          transaction_id: sharedTxn,
        }),
      );

      // Simulate a race: destination already has a sub with the same original_transaction_id
      // (e.g. a concurrent webhook ingest fired on the destination)
      await dispatch(
        t,
        basePayload({
          id: "evt_p10_dst_pre",
          type: "INITIAL_PURCHASE",
          app_user_id: "user_p10_dst",
          expiration_at_ms: expiry,
          original_transaction_id: sharedTxn,
          transaction_id: sharedTxn,
        }),
      );

      await t.mutation(internal.handlers.processTransfer, {
        event: {
          type: "TRANSFER",
          id: "evt_p10_transfer",
          app_id: "app_parity",
          app_user_id: "user_p10_dst",
          aliases: [],
          event_timestamp_ms: Date.now(),
          environment: "SANDBOX",
          transferred_from: ["user_p10_src"],
          transferred_to: ["user_p10_dst"],
        },
      });

      const destSubs = await t.query(api.subscriptions.getByUser, {
        appUserId: "user_p10_dst",
      });
      const srcSubs = await t.query(api.subscriptions.getByUser, {
        appUserId: "user_p10_src",
      });
      expect(destSubs).toHaveLength(1);
      expect(srcSubs).toHaveLength(0);
    });
  });

  describe("lifetime vs finite selection in transfer/alias", () => {
    async function seedEntitlement(
      t: ReturnType<typeof initConvexTest>,
      userId: string,
      txn: string,
      expiresAtMs: number | undefined,
      eventId: string,
    ) {
      const payload = basePayload({
        id: eventId,
        type: "INITIAL_PURCHASE",
        app_user_id: userId,
        original_transaction_id: txn,
        transaction_id: txn,
      });
      if (expiresAtMs === undefined) {
        payload.expiration_at_ms = undefined as unknown as number;
      } else {
        payload.expiration_at_ms = expiresAtMs;
      }
      await dispatch(t, payload);
    }

    test("TRANSFER with lifetime source beats finite destination", async () => {
      const t = initConvexTest();
      const destExpiry = Date.now() + 30 * 24 * 60 * 60 * 1000;

      await seedEntitlement(
        t,
        "user_life_src",
        "otxn_life_src",
        undefined,
        "evt_life_src",
      );
      await seedEntitlement(
        t,
        "user_life_dst",
        "otxn_life_dst",
        destExpiry,
        "evt_life_dst",
      );

      await t.mutation(internal.handlers.processTransfer, {
        event: {
          type: "TRANSFER",
          id: "evt_life_transfer",
          app_id: "app_parity",
          app_user_id: "user_life_dst",
          aliases: [],
          event_timestamp_ms: Date.now(),
          environment: "SANDBOX",
          transferred_from: ["user_life_src"],
          transferred_to: ["user_life_dst"],
          entitlement_ids: ["premium"],
        },
      });

      const ents = await t.query(api.entitlements.list, {
        appUserId: "user_life_dst",
      });
      const premium = ents.find((e) => e.entitlementId === "premium")!;
      expect(premium.expiresAtMs).toBeUndefined();
    });

    test("TRANSFER with finite source keeps lifetime destination", async () => {
      const t = initConvexTest();
      const srcExpiry = Date.now() + 30 * 24 * 60 * 60 * 1000;

      await seedEntitlement(
        t,
        "user_flife_dst",
        "otxn_flife_dst",
        undefined,
        "evt_flife_dst",
      );
      await seedEntitlement(
        t,
        "user_flife_src",
        "otxn_flife_src",
        srcExpiry,
        "evt_flife_src",
      );

      await t.mutation(internal.handlers.processTransfer, {
        event: {
          type: "TRANSFER",
          id: "evt_flife_transfer",
          app_id: "app_parity",
          app_user_id: "user_flife_dst",
          aliases: [],
          event_timestamp_ms: Date.now(),
          environment: "SANDBOX",
          transferred_from: ["user_flife_src"],
          transferred_to: ["user_flife_dst"],
          entitlement_ids: ["premium"],
        },
      });

      const ents = await t.query(api.entitlements.list, {
        appUserId: "user_flife_dst",
      });
      const premium = ents.find((e) => e.entitlementId === "premium")!;
      expect(premium.expiresAtMs).toBeUndefined();
    });

    test("SUBSCRIBER_ALIAS with lifetime source beats finite existing", async () => {
      const t = initConvexTest();
      const existingExpiry = Date.now() + 30 * 24 * 60 * 60 * 1000;

      await seedEntitlement(
        t,
        "user_alias_existing",
        "otxn_ae",
        existingExpiry,
        "evt_alias_ex",
      );
      await seedEntitlement(
        t,
        "$RCAnonymousID:alias_src_life",
        "otxn_als",
        undefined,
        "evt_als",
      );

      await t.mutation(internal.handlers.processSubscriberAlias, {
        event: {
          type: "SUBSCRIBER_ALIAS",
          id: "evt_alias_life",
          app_id: "app_parity",
          app_user_id: "user_alias_existing",
          original_app_user_id: "$RCAnonymousID:alias_src_life",
          aliases: [],
          event_timestamp_ms: Date.now(),
          environment: "SANDBOX",
        },
      });

      const ents = await t.query(api.entitlements.list, {
        appUserId: "user_alias_existing",
      });
      const premium = ents.find((e) => e.entitlementId === "premium")!;
      expect(premium.expiresAtMs).toBeUndefined();
    });

    test("SUBSCRIBER_ALIAS with finite source keeps lifetime existing", async () => {
      const t = initConvexTest();
      const srcExpiry = Date.now() + 30 * 24 * 60 * 60 * 1000;

      await seedEntitlement(
        t,
        "user_alias_life_ex",
        "otxn_ale",
        undefined,
        "evt_alias_le",
      );
      await seedEntitlement(
        t,
        "$RCAnonymousID:alias_src_fin",
        "otxn_alsf",
        srcExpiry,
        "evt_alsf",
      );

      await t.mutation(internal.handlers.processSubscriberAlias, {
        event: {
          type: "SUBSCRIBER_ALIAS",
          id: "evt_alias_finite",
          app_id: "app_parity",
          app_user_id: "user_alias_life_ex",
          original_app_user_id: "$RCAnonymousID:alias_src_fin",
          aliases: [],
          event_timestamp_ms: Date.now(),
          environment: "SANDBOX",
        },
      });

      const ents = await t.query(api.entitlements.list, {
        appUserId: "user_alias_life_ex",
      });
      const premium = ents.find((e) => e.entitlementId === "premium")!;
      expect(premium.expiresAtMs).toBeUndefined();
    });
  });

  describe("sync.ts derives autoRenewStatus from five signals", () => {
    const isoIn = (daysFromNow: number) =>
      new Date(Date.now() + daysFromNow * 86_400_000).toISOString();

    async function ingestSub(
      t: ReturnType<typeof initConvexTest>,
      appUserId: string,
      sub: Record<string, unknown>,
    ) {
      await t.mutation(api.sync.ingest, {
        appUserId,
        subscriber: {
          first_seen: "2026-01-01T00:00:00Z",
          subscriptions: { premium_monthly: sub },
          entitlements: {
            premium: {
              expires_date:
                (sub.expires_date as string | null | undefined) ?? null,
              product_identifier: "premium_monthly",
              purchase_date: "2026-01-01T00:00:00Z",
            },
          },
        },
      });
    }

    test("PREPAID period stores autoRenewStatus false", async () => {
      const t = initConvexTest();
      await ingestSub(t, "sync_prepaid", {
        store: "APP_STORE",
        is_sandbox: false,
        period_type: "prepaid",
        expires_date: isoIn(30),
        purchase_date: "2026-01-01T00:00:00Z",
        original_purchase_date: "2026-01-01T00:00:00Z",
        store_transaction_id: "sync_prepaid_txn",
      });
      const subs = await t.query(api.subscriptions.getByUser, {
        appUserId: "sync_prepaid",
      });
      expect(subs[0].autoRenewStatus).toBe(false);
    });

    test("PROMOTIONAL store stores autoRenewStatus false", async () => {
      const t = initConvexTest();
      await ingestSub(t, "sync_promo", {
        store: "PROMOTIONAL",
        is_sandbox: false,
        period_type: "normal",
        expires_date: isoIn(30),
        purchase_date: "2026-01-01T00:00:00Z",
        original_purchase_date: "2026-01-01T00:00:00Z",
        store_transaction_id: "sync_promo_txn",
      });
      const subs = await t.query(api.subscriptions.getByUser, {
        appUserId: "sync_promo",
      });
      expect(subs[0].autoRenewStatus).toBe(false);
    });

    test("billing_issues_detected_at stores autoRenewStatus false", async () => {
      const t = initConvexTest();
      await ingestSub(t, "sync_billing", {
        store: "APP_STORE",
        is_sandbox: false,
        period_type: "normal",
        expires_date: isoIn(30),
        purchase_date: "2026-01-01T00:00:00Z",
        original_purchase_date: "2026-01-01T00:00:00Z",
        store_transaction_id: "sync_billing_txn",
        billing_issues_detected_at: isoIn(-1),
        auto_renew_status: true,
      });
      const subs = await t.query(api.subscriptions.getByUser, {
        appUserId: "sync_billing",
      });
      expect(subs[0].autoRenewStatus).toBe(false);
    });

    test("unsubscribe_detected_at stores autoRenewStatus false", async () => {
      const t = initConvexTest();
      await ingestSub(t, "sync_unsub", {
        store: "APP_STORE",
        is_sandbox: false,
        period_type: "normal",
        expires_date: isoIn(30),
        purchase_date: "2026-01-01T00:00:00Z",
        original_purchase_date: "2026-01-01T00:00:00Z",
        store_transaction_id: "sync_unsub_txn",
        unsubscribe_detected_at: isoIn(-1),
        auto_renew_status: true,
      });
      const subs = await t.query(api.subscriptions.getByUser, {
        appUserId: "sync_unsub",
      });
      expect(subs[0].autoRenewStatus).toBe(false);
    });

    test("healthy normal sub stores autoRenewStatus true", async () => {
      const t = initConvexTest();
      await ingestSub(t, "sync_healthy", {
        store: "APP_STORE",
        is_sandbox: false,
        period_type: "normal",
        expires_date: isoIn(30),
        purchase_date: "2026-01-01T00:00:00Z",
        original_purchase_date: "2026-01-01T00:00:00Z",
        store_transaction_id: "sync_healthy_txn",
      });
      const subs = await t.query(api.subscriptions.getByUser, {
        appUserId: "sync_healthy",
      });
      expect(subs[0].autoRenewStatus).toBe(true);
    });
  });

  describe("purgeAnonymousCustomerIfEmpty bails when source has active data", () => {
    test("partial TRANSFER leaves anonymous customer row in place", async () => {
      const t = initConvexTest();
      const anonId = "$RCAnonymousID:partial_src";
      const futureExpiry = Date.now() + 30 * 24 * 60 * 60 * 1000;

      // Source owns TWO entitlements on ONE subscription
      const initPayload = basePayload({
        id: "evt_partial_init",
        type: "INITIAL_PURCHASE",
        app_user_id: anonId,
        expiration_at_ms: futureExpiry,
        original_transaction_id: "otxn_partial",
        transaction_id: "otxn_partial",
        entitlement_ids: ["premium", "bonus"],
      });
      await dispatch(t, initPayload);

      // Transfer ONLY the premium entitlement. Bonus stays on source
      await t.mutation(internal.handlers.processTransfer, {
        event: {
          type: "TRANSFER",
          id: "evt_partial_transfer",
          app_id: "app_parity",
          app_user_id: "user_partial_dst",
          aliases: [],
          event_timestamp_ms: Date.now(),
          environment: "SANDBOX",
          transferred_from: [anonId],
          transferred_to: ["user_partial_dst"],
          entitlement_ids: ["premium"],
        },
      });

      // Source customer row MUST still exist: bonus entitlement is still active on it
      const sourceCustomer = await t.query(api.customers.get, {
        appUserId: anonId,
      });
      expect(sourceCustomer).not.toBeNull();

      // And the un-transferred entitlement is still there and active
      const sourceEnts = await t.query(api.entitlements.list, {
        appUserId: anonId,
      });
      const bonus = sourceEnts.find((e) => e.entitlementId === "bonus");
      expect(bonus?.isActive).toBe(true);
    });
  });
});
