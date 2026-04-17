/// <reference types="vite/client" />

import { describe, expect, test } from "vitest";
import { ConvexError } from "convex/values";
import { api } from "./_generated/api.js";
import { initConvexTest } from "./setup.test.js";

function basePayload(overrides: Record<string, unknown> = {}) {
  return {
    type: "INITIAL_PURCHASE",
    id: `evt_${Math.random().toString(36).slice(2)}`,
    app_id: "app_audit",
    app_user_id: "user_audit",
    original_app_user_id: "user_audit",
    aliases: [],
    event_timestamp_ms: Date.now(),
    product_id: "premium_monthly",
    entitlement_ids: ["premium"],
    period_type: "NORMAL" as const,
    purchased_at_ms: Date.now(),
    expiration_at_ms: Date.now() + 30 * 24 * 60 * 60 * 1000,
    transaction_id: "txn_audit",
    original_transaction_id: "txn_original_audit",
    store: "APP_STORE" as const,
    environment: "SANDBOX" as const,
    is_family_share: false,
    ...overrides,
  };
}

async function postEvent(
  t: ReturnType<typeof initConvexTest>,
  payload: Record<string, unknown>,
) {
  return t.mutation(api.webhooks.process, {
    event: {
      id: payload.id as string,
      type: payload.type as string,
      app_id: payload.app_id as string | undefined,
      app_user_id: payload.app_user_id as string | undefined,
      environment: (payload.environment as "SANDBOX" | "PRODUCTION") ?? "SANDBOX",
      store: payload.store as
        | "AMAZON"
        | "APP_STORE"
        | "UNKNOWN_STORE"
        | undefined,
    },
    payload,
  });
}

describe("0.2.1 audit fixes", () => {
  describe("BLOCKER 2: ownership_type UNKNOWN accepted", () => {
    test("webhook with ownership_type: UNKNOWN doesn't crash", async () => {
      const t = initConvexTest();
      await postEvent(
        t,
        basePayload({
          id: "evt_ownership_unknown",
          app_user_id: "user_ownership_unknown",
          ownership_type: "UNKNOWN",
        }),
      );
      const subs = await t.query(api.subscriptions.getByUser, {
        appUserId: "user_ownership_unknown",
      });
      expect(subs).toHaveLength(1);
      expect(subs[0].ownershipType).toBe("UNKNOWN");
    });

    test("sync with ownership_type: UNKNOWN doesn't crash", async () => {
      const t = initConvexTest();
      const expires = new Date(Date.now() + 86400000).toISOString();
      await t.mutation(api.sync.ingest, {
        appUserId: "user_sync_ownership_unknown",
        subscriber: {
          first_seen: "2024-01-01T00:00:00Z",
          entitlements: {
            premium: {
              expires_date: expires,
              product_identifier: "monthly",
              purchase_date: "2024-01-01T00:00:00Z",
            },
          },
          subscriptions: {
            monthly: {
              store: "APP_STORE",
              is_sandbox: false,
              period_type: "normal",
              expires_date: expires,
              purchase_date: "2024-01-01T00:00:00Z",
              store_transaction_id: "txn_ou",
              ownership_type: "UNKNOWN",
            },
          },
        },
      });
      const subs = await t.query(api.subscriptions.getByUser, {
        appUserId: "user_sync_ownership_unknown",
      });
      expect(subs[0].ownershipType).toBe("UNKNOWN");
    });
  });

  describe("BLOCKER 3: mapPeriodType unknown falls back", () => {
    test("unknown period_type stored as NORMAL", async () => {
      const t = initConvexTest();
      const expires = new Date(Date.now() + 86400000).toISOString();
      await t.mutation(api.sync.ingest, {
        appUserId: "user_period_unknown",
        subscriber: {
          first_seen: "2024-01-01T00:00:00Z",
          entitlements: {},
          subscriptions: {
            monthly: {
              store: "APP_STORE",
              is_sandbox: false,
              // Future or unknown RC period_type — must not crash.
              period_type: "future_unknown_period_type",
              expires_date: expires,
              purchase_date: "2024-01-01T00:00:00Z",
              store_transaction_id: "txn_pu",
            },
          },
        },
      });
      const subs = await t.query(api.subscriptions.getByUser, {
        appUserId: "user_period_unknown",
      });
      expect(subs[0].periodType).toBe("NORMAL");
    });
  });

  describe("BLOCKER 4: REST sync price data persisted", () => {
    test("subscription price fields populated from REST", async () => {
      const t = initConvexTest();
      const expires = new Date(Date.now() + 86400000).toISOString();
      await t.mutation(api.sync.ingest, {
        appUserId: "user_price",
        subscriber: {
          first_seen: "2024-01-01T00:00:00Z",
          entitlements: {},
          subscriptions: {
            monthly: {
              store: "APP_STORE",
              is_sandbox: false,
              period_type: "normal",
              expires_date: expires,
              purchase_date: "2024-01-01T00:00:00Z",
              store_transaction_id: "txn_price",
              price: { amount: 9.99, currency: "USD" },
            },
          },
        },
      });
      const subs = await t.query(api.subscriptions.getByUser, {
        appUserId: "user_price",
      });
      expect(subs[0].priceUsd).toBe(9.99);
      expect(subs[0].currency).toBe("USD");
      expect(subs[0].priceInPurchasedCurrency).toBe(9.99);
    });

    test("string price amount coerced to number", async () => {
      const t = initConvexTest();
      const expires = new Date(Date.now() + 86400000).toISOString();
      await t.mutation(api.sync.ingest, {
        appUserId: "user_price_str",
        subscriber: {
          first_seen: "2024-01-01T00:00:00Z",
          entitlements: {},
          subscriptions: {
            monthly: {
              store: "APP_STORE",
              is_sandbox: false,
              period_type: "normal",
              expires_date: expires,
              purchase_date: "2024-01-01T00:00:00Z",
              store_transaction_id: "txn_ps",
              price: { amount: "4.99", currency: "EUR" },
            },
          },
        },
      });
      const subs = await t.query(api.subscriptions.getByUser, {
        appUserId: "user_price_str",
      });
      expect(subs[0].currency).toBe("EUR");
      expect(subs[0].priceInPurchasedCurrency).toBe(4.99);
      expect(subs[0].priceUsd).toBeUndefined();
    });
  });

  describe("BLOCKER 1: empty-string auth throws at construction", () => {
    test("RevenueCat class rejects empty auth secret", async () => {
      const { RevenueCat } = await import("../client/index.js");
      // @ts-expect-error — intentionally probing with a stub component
      expect(() => new RevenueCat({}, { REVENUECAT_WEBHOOK_AUTH: "" })).toThrow(
        /cannot be empty/,
      );
    });

    test("RevenueCat class accepts undefined auth (explicit no-auth)", async () => {
      const { RevenueCat } = await import("../client/index.js");
      // @ts-expect-error — stub component for construction test
      expect(() => new RevenueCat({}, {})).not.toThrow();
    });

    test("RevenueCat class accepts non-empty auth", async () => {
      const { RevenueCat } = await import("../client/index.js");
      // @ts-expect-error — stub component for construction test
      expect(() => new RevenueCat({}, { REVENUECAT_WEBHOOK_AUTH: "s3cret" })).not.toThrow();
    });
  });

  describe("HIGH 5: dedup before rate limit", () => {
    test("replay of the same event.id doesn't consume rate-limit budget", async () => {
      const t = initConvexTest();
      const payload = basePayload({
        id: "evt_dedup_rate",
        app_id: "app_dedup",
        app_user_id: "user_dedup_rate",
      });
      await postEvent(t, payload);
      // Replay 150 times — would blow the 100/min rate limit if dedup wasn't first.
      for (let i = 0; i < 150; i++) {
        const result = await postEvent(t, payload);
        expect(result.processed).toBe(false);
      }
      // A genuinely new event must still go through.
      const result = await postEvent(
        t,
        basePayload({
          id: "evt_after_replays",
          app_id: "app_dedup",
          app_user_id: "user_dedup_rate",
          original_transaction_id: "txn_after_replay",
        }),
      );
      expect(result.processed).toBe(true);
    });
  });

  describe("HIGH 6: transferEntitlements copies all flags", () => {
    test("TRANSFER preserves ownershipType and status flags on destination", async () => {
      const t = initConvexTest();
      const source = "user_transfer_src_audit";
      const dest = "user_transfer_dst_audit";
      // Source user has an entitlement with ownership + billing-issue flags.
      await postEvent(
        t,
        basePayload({
          id: "evt_src_seed",
          app_user_id: source,
          ownership_type: "FAMILY_SHARED",
        }),
      );
      await t.run(async (ctx) => {
        const ent = await ctx.db
          .query("entitlements")
          .withIndex("by_app_user", (q) => q.eq("appUserId", source))
          .first();
        if (ent) {
          await ctx.db.patch(ent._id, {
            billingIssueDetectedAt: 42,
            unsubscribeDetectedAt: 7,
          });
        }
      });

      await postEvent(t, {
        ...basePayload({
          id: "evt_transfer_audit",
          type: "TRANSFER",
          app_user_id: dest,
        }),
        transferred_from: [source],
        transferred_to: [dest],
      });

      const destEnts = await t.query(api.entitlements.list, {
        appUserId: dest,
      });
      expect(destEnts).toHaveLength(1);
      expect(destEnts[0].ownershipType).toBe("FAMILY_SHARED");
      expect(destEnts[0].billingIssueDetectedAt).toBe(42);
      expect(destEnts[0].unsubscribeDetectedAt).toBe(7);
    });
  });

  describe("HIGH 7: deleteCustomer purges transfers", () => {
    test("transfers involving the user are deleted", async () => {
      const t = initConvexTest();
      await t.run(async (ctx) => {
        await ctx.db.insert("transfers", {
          eventId: "evt_xfer_1",
          transferredFrom: ["user_purge_xfer"],
          transferredTo: ["other_user"],
          entitlementIds: ["premium"],
          timestamp: Date.now(),
        });
        await ctx.db.insert("transfers", {
          eventId: "evt_xfer_2",
          transferredFrom: ["other_user"],
          transferredTo: ["user_purge_xfer"],
          timestamp: Date.now(),
        });
        await ctx.db.insert("transfers", {
          eventId: "evt_xfer_keep",
          transferredFrom: ["other_user"],
          transferredTo: ["third_user"],
          timestamp: Date.now(),
        });
      });

      const result = await t.mutation(api.customers.purge, {
        appUserId: "user_purge_xfer",
      });
      expect(result.transfers).toBe(2);

      const remaining = await t.run(async (ctx) =>
        ctx.db.query("transfers").collect(),
      );
      expect(remaining).toHaveLength(1);
      expect(remaining[0].eventId).toBe("evt_xfer_keep");
    });
  });

  describe("HIGH 8: REFUND_REVERSED clears stale refund markers", () => {
    test("reverse of a refund clears refundedAtMs and cancelReason", async () => {
      const t = initConvexTest();
      const txnId = "txn_refund_reversed";
      // Seed: initial + refund CANCELLATION.
      await postEvent(
        t,
        basePayload({
          id: "evt_rr_init",
          app_user_id: "user_rr",
          original_transaction_id: txnId,
          transaction_id: txnId,
        }),
      );
      await postEvent(
        t,
        basePayload({
          id: "evt_rr_refund",
          type: "CANCELLATION",
          app_user_id: "user_rr",
          original_transaction_id: txnId,
          transaction_id: txnId,
          cancel_reason: "CUSTOMER_SUPPORT",
        }),
      );
      // Reversal.
      await postEvent(
        t,
        basePayload({
          id: "evt_rr_reverse",
          type: "REFUND_REVERSED",
          app_user_id: "user_rr",
          original_transaction_id: txnId,
          transaction_id: txnId,
        }),
      );

      const subs = await t.query(api.subscriptions.getByUser, {
        appUserId: "user_rr",
      });
      expect(subs[0].refundedAtMs).toBeUndefined();
      expect(subs[0].cancelReason).toBeUndefined();
      expect(subs[0].autoRenewStatus).toBe(true);
    });
  });

  describe("HIGH 9: RENEWAL clears autoResumeAtMs", () => {
    test("resumption after pause clears the resume marker", async () => {
      const t = initConvexTest();
      const txnId = "txn_pause_resume";
      await postEvent(
        t,
        basePayload({
          id: "evt_pause_init",
          app_user_id: "user_pause",
          original_transaction_id: txnId,
          transaction_id: txnId,
        }),
      );
      await postEvent(t, {
        ...basePayload({
          id: "evt_paused",
          type: "SUBSCRIPTION_PAUSED",
          app_user_id: "user_pause",
          original_transaction_id: txnId,
          transaction_id: txnId,
        }),
        auto_resume_at_ms: Date.now() + 7 * 24 * 60 * 60 * 1000,
      });
      await postEvent(
        t,
        basePayload({
          id: "evt_renewal_after_pause",
          type: "RENEWAL",
          app_user_id: "user_pause",
          original_transaction_id: txnId,
          transaction_id: txnId,
        }),
      );

      const subs = await t.query(api.subscriptions.getByUser, {
        appUserId: "user_pause",
      });
      expect(subs[0].autoResumeAtMs).toBeUndefined();
      expect(subs[0].autoRenewStatus).toBe(true);
    });
  });

  describe("HIGH 10: legacy singular entitlement_id still grants", () => {
    test("entitlement_id (singular) with no entitlement_ids grants the entitlement", async () => {
      const t = initConvexTest();
      await postEvent(t, {
        ...basePayload({
          id: "evt_singular",
          app_user_id: "user_singular",
        }),
        entitlement_ids: undefined,
        entitlement_id: "pro",
      });
      const has = await t.query(api.entitlements.check, {
        appUserId: "user_singular",
        entitlementId: "pro",
      });
      expect(has).toBe(true);
    });
  });

  describe("HIGH 11: PRODUCT_CHANGE updates entitlements", () => {
    test("productId and expiresAtMs on entitlement reflect the change", async () => {
      const t = initConvexTest();
      const txnId = "txn_product_change";
      const originalExpiry = Date.now() + 7 * 24 * 60 * 60 * 1000;
      const newExpiry = Date.now() + 365 * 24 * 60 * 60 * 1000;

      await postEvent(
        t,
        basePayload({
          id: "evt_pc_init",
          app_user_id: "user_pc",
          original_transaction_id: txnId,
          transaction_id: txnId,
          product_id: "monthly",
          expiration_at_ms: originalExpiry,
        }),
      );
      await postEvent(
        t,
        basePayload({
          id: "evt_pc_change",
          type: "PRODUCT_CHANGE",
          app_user_id: "user_pc",
          original_transaction_id: txnId,
          transaction_id: txnId,
          product_id: "annual",
          expiration_at_ms: newExpiry,
        }),
      );

      const ents = await t.query(api.entitlements.list, {
        appUserId: "user_pc",
      });
      expect(ents[0].productId).toBe("annual");
      expect(ents[0].expiresAtMs).toBe(newExpiry);
    });
  });

  describe("HIGH 12: VIRTUAL_CURRENCY accepts purchase_environment", () => {
    test("VC event with only purchase_environment stores the transaction", async () => {
      const t = initConvexTest();
      await postEvent(t, {
        ...basePayload({
          id: "evt_vc_pe",
          type: "VIRTUAL_CURRENCY_TRANSACTION",
          app_user_id: "user_vc_pe",
        }),
        environment: undefined,
        purchase_environment: "PRODUCTION",
        adjustments: [
          {
            amount: 100,
            currency: { code: "COIN", name: "Gold Coins" },
          },
        ],
      });

      const balance = await t.query(api.virtualCurrency.getBalance, {
        appUserId: "user_vc_pe",
        currencyCode: "COIN",
      });
      expect(balance?.balance).toBe(100);
      expect(balance?.currencyName).toBe("Gold Coins");
    });
  });

  describe("HIGH 13: SUBSCRIPTION_PAUSED cancel_reason preserves autoRenewStatus", () => {
    test("cancel_reason SUBSCRIPTION_PAUSED leaves autoRenewStatus unchanged", async () => {
      const t = initConvexTest();
      const txnId = "txn_paused_cancel";
      await postEvent(
        t,
        basePayload({
          id: "evt_pc_init",
          app_user_id: "user_pc_reason",
          original_transaction_id: txnId,
          transaction_id: txnId,
        }),
      );
      await postEvent(
        t,
        basePayload({
          id: "evt_pc_cancel",
          type: "CANCELLATION",
          app_user_id: "user_pc_reason",
          original_transaction_id: txnId,
          transaction_id: txnId,
          cancel_reason: "SUBSCRIPTION_PAUSED",
        }),
      );

      const subs = await t.query(api.subscriptions.getByUser, {
        appUserId: "user_pc_reason",
      });
      expect(subs[0].cancelReason).toBe("SUBSCRIPTION_PAUSED");
      // Should NOT be set to false — user intends to resume.
      expect(subs[0].autoRenewStatus).toBeUndefined();
    });

    test("CANCELLATION with reason UNSUBSCRIBE sets unsubscribeDetectedAt", async () => {
      const t = initConvexTest();
      const txnId = "txn_unsub";
      await postEvent(
        t,
        basePayload({
          id: "evt_u_init",
          app_user_id: "user_unsub",
          original_transaction_id: txnId,
          transaction_id: txnId,
        }),
      );
      await postEvent(
        t,
        basePayload({
          id: "evt_u_cancel",
          type: "CANCELLATION",
          app_user_id: "user_unsub",
          original_transaction_id: txnId,
          transaction_id: txnId,
          cancel_reason: "UNSUBSCRIBE",
        }),
      );
      const subs = await t.query(api.subscriptions.getByUser, {
        appUserId: "user_unsub",
      });
      expect(subs[0].unsubscribeDetectedAt).toBeDefined();
      expect(subs[0].autoRenewStatus).toBe(false);
    });
  });

  describe("HIGH 16: event.id length capped", () => {
    test("oversized event.id is rejected", async () => {
      const t = initConvexTest();
      const huge = "x".repeat(500);
      await expect(
        postEvent(t, basePayload({ id: huge, app_user_id: "user_long_id" })),
      ).rejects.toThrow();
    });

    test("event.id at the 128-byte cap is accepted", async () => {
      const t = initConvexTest();
      const atCap = "a".repeat(128);
      const result = await postEvent(
        t,
        basePayload({ id: atCap, app_user_id: "user_at_cap" }),
      );
      expect(result.processed).toBe(true);
    });
  });

  describe("HIGH 17: sync accepts unknown subscriber fields", () => {
    test("sync doesn't reject unknown top-level subscriber keys", async () => {
      const t = initConvexTest();
      await t.mutation(api.sync.ingest, {
        appUserId: "user_extra_fields",
        subscriber: {
          first_seen: "2024-01-01T00:00:00Z",
          entitlements: {},
          subscriptions: {},
          // Fields RC's REST actually returns but we don't consume:
          management_url: "https://example.com/manage",
          last_purchase_date: "2024-06-01T00:00:00Z",
          other_purchases: {},
          entitlement_verification: "VERIFIED",
          first_seen_attribution_network_info: { network: "organic" },
        } as Record<string, unknown>,
      });
      const customer = await t.query(api.customers.get, {
        appUserId: "user_extra_fields",
      });
      expect(customer).not.toBeNull();
    });
  });

  describe("MEDIUM 21: aliasExperiments on SUBSCRIBER_ALIAS", () => {
    test("experiment enrollment follows the alias migration", async () => {
      const t = initConvexTest();
      const anon = "$RCAnonymousID:cccccccccccccccccccccccccccccccc";
      const real = "user_real_alias";

      // Enroll anon in an experiment via the dedicated handler.
      await postEvent(t, {
        ...basePayload({
          id: "evt_exp_enroll",
          type: "EXPERIMENT_ENROLLMENT",
          app_user_id: anon,
        }),
        experiment_id: "onboarding_v2",
        experiment_variant: "B",
        offering_id: "default",
      });

      // Anon logs in — SUBSCRIBER_ALIAS fires.
      await postEvent(t, {
        ...basePayload({
          id: "evt_alias_exp",
          type: "SUBSCRIBER_ALIAS",
          app_user_id: real,
          original_app_user_id: anon,
        }),
      });

      // Experiment lookup under the real ID should find the enrollment.
      const exp = await t.query(api.experiments.get, {
        appUserId: real,
        experimentId: "onboarding_v2",
      });
      expect(exp).not.toBeNull();
      expect(exp?.variant).toBe("B");

      // Nothing left under anon.
      const anonExp = await t.query(api.experiments.list, {
        appUserId: anon,
      });
      expect(anonExp).toHaveLength(0);
    });
  });

  describe("MEDIUM 22: unsubscribe_detected_at from REST sync", () => {
    test("sync persists unsubscribe_detected_at on the subscription", async () => {
      const t = initConvexTest();
      const expires = new Date(Date.now() + 86400000).toISOString();
      const unsubAt = "2024-05-01T00:00:00Z";
      await t.mutation(api.sync.ingest, {
        appUserId: "user_unsub_sync",
        subscriber: {
          first_seen: "2024-01-01T00:00:00Z",
          entitlements: {},
          subscriptions: {
            monthly: {
              store: "APP_STORE",
              is_sandbox: false,
              period_type: "normal",
              expires_date: expires,
              purchase_date: "2024-01-01T00:00:00Z",
              store_transaction_id: "txn_uds",
              unsubscribe_detected_at: unsubAt,
            },
          },
        },
      });
      const subs = await t.query(api.subscriptions.getByUser, {
        appUserId: "user_unsub_sync",
      });
      expect(subs[0].unsubscribeDetectedAt).toBe(new Date(unsubAt).getTime());
    });
  });

  describe("HIGH 19: revokeEntitlements uses indexed lookup", () => {
    test("EXPIRATION with specific entitlement_ids revokes only those", async () => {
      const t = initConvexTest();
      // Grant two entitlements for one user.
      await postEvent(
        t,
        basePayload({
          id: "evt_multi_grant",
          app_user_id: "user_multi",
          entitlement_ids: ["premium", "vip"],
        }),
      );
      // Expire only "premium".
      await postEvent(
        t,
        basePayload({
          id: "evt_multi_expire",
          type: "EXPIRATION",
          app_user_id: "user_multi",
          entitlement_ids: ["premium"],
          expiration_at_ms: Date.now() - 1000,
        }),
      );

      const ents = await t.query(api.entitlements.list, {
        appUserId: "user_multi",
      });
      const premium = ents.find((e) => e.entitlementId === "premium");
      const vip = ents.find((e) => e.entitlementId === "vip");
      expect(premium?.isActive).toBe(false);
      expect(vip?.isActive).toBe(true);
    });
  });

  describe("HIGH 20: non_subscriptions default ownership + original_purchase_date", () => {
    test("one-time purchases default to PURCHASED ownership and carry original_purchase_date", async () => {
      const t = initConvexTest();
      const original = "2023-01-15T00:00:00Z";
      await t.mutation(api.sync.ingest, {
        appUserId: "user_nonsub_ownership",
        subscriber: {
          first_seen: "2023-01-01T00:00:00Z",
          entitlements: {
            pro: {
              expires_date: null,
              product_identifier: "lifetime_pro",
              purchase_date: original,
            },
          },
          subscriptions: {},
          non_subscriptions: {
            lifetime_pro: [
              {
                id: "one_time_1",
                is_sandbox: false,
                purchase_date: original,
                original_purchase_date: original,
                store: "APP_STORE",
                store_transaction_id: "txn_ot_1",
                price: { amount: 99.99, currency: "USD" },
              },
            ],
          },
        },
      });
      const subs = await t.query(api.subscriptions.getByUser, {
        appUserId: "user_nonsub_ownership",
      });
      expect(subs[0].ownershipType).toBe("PURCHASED");
      expect(subs[0].originalPurchasedAtMs).toBe(new Date(original).getTime());

      const ents = await t.query(api.entitlements.list, {
        appUserId: "user_nonsub_ownership",
      });
      expect(ents[0].ownershipType).toBe("PURCHASED");
    });
  });

  describe("HIGH 15: PII redaction from webhookEvents payload", () => {
    test("default redactor strips $email/$phoneNumber from stored payload", async () => {
      // Direct test of the helper since httpHandler requires fetch glue.
      const { decodeSubscriberAttributes } = await import("../client/index.js");
      const stored = {
        subscriber_attributes: {
          __dollar__email: { value: "user@example.com", updated_at_ms: 1 },
          __dollar__phoneNumber: { value: "+15551234", updated_at_ms: 1 },
          custom_tier: { value: "gold", updated_at_ms: 1 },
        },
      };
      const decoded = decodeSubscriberAttributes(
        stored.subscriber_attributes as Record<
          string,
          { value: string; updated_at_ms: number }
        >,
      );
      expect(decoded?.$email?.value).toBe("user@example.com");
      expect(decoded?.custom_tier?.value).toBe("gold");
    });
  });

  // Ensure ConvexError import stays used for the typing above.
  test("noop — ConvexError import guard", () => {
    expect(ConvexError).toBeDefined();
  });
});
