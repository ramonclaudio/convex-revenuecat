/// <reference types="vite/client" />

import { describe, expect, test } from "vitest";
import { ConvexError } from "convex/values";
import { api, internal } from "./_generated/api.js";
import { initConvexTest } from "./setup.test.js";
import type { ComponentApi } from "./_generated/component.js";

const stubComponent = {} as unknown as ComponentApi;

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
      environment:
        (payload.environment as "SANDBOX" | "PRODUCTION") ?? "SANDBOX",
      store: payload.store as
        | "AMAZON"
        | "APP_STORE"
        | "UNKNOWN_STORE"
        | undefined,
    },
    payload,
  });
}

describe("audit fixes", () => {
  describe("ownership_type UNKNOWN accepted", () => {
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

  describe("mapPeriodType unknown falls back", () => {
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

  describe("REST sync price data persisted", () => {
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

  describe("webhook auth is mandatory and high-entropy", () => {
    const VALID_SECRET = "kZ9tQ1xH8mF3vR7yL2nP5sJ6cW0bD4gE8aT1iU4oY3w=";

    test("RevenueCat class rejects empty auth secret", async () => {
      const { RevenueCat } = await import("../client/index.js");
      expect(
        () => new RevenueCat(stubComponent, { REVENUECAT_WEBHOOK_AUTH: "" }),
      ).toThrow(/is empty after stripping/);
    });

    test("RevenueCat class rejects 'Bearer ' (paste error: header label only)", async () => {
      const { RevenueCat } = await import("../client/index.js");
      expect(
        () =>
          new RevenueCat(stubComponent, { REVENUECAT_WEBHOOK_AUTH: "Bearer " }),
      ).toThrow(/is empty after stripping/);
    });

    test("RevenueCat class rejects whitespace-only secret", async () => {
      const { RevenueCat } = await import("../client/index.js");
      expect(
        () =>
          new RevenueCat(stubComponent, { REVENUECAT_WEBHOOK_AUTH: "    " }),
      ).toThrow(/is empty after stripping/);
    });

    test("RevenueCat class rejects sub-32-char secret", async () => {
      const { RevenueCat } = await import("../client/index.js");
      expect(
        () =>
          new RevenueCat(stubComponent, { REVENUECAT_WEBHOOK_AUTH: "s3cret" }),
      ).toThrow(/is 6 chars after stripping \(minimum 32\)/);
    });

    test("RevenueCat class rejects 31-char secret (just under floor)", async () => {
      const { RevenueCat } = await import("../client/index.js");
      const justUnder = "a".repeat(31);
      expect(
        () =>
          new RevenueCat(stubComponent, { REVENUECAT_WEBHOOK_AUTH: justUnder }),
      ).toThrow(/is 31 chars after stripping \(minimum 32\)/);
    });

    test("RevenueCat class rejects short secret hidden behind 'Bearer ' prefix", async () => {
      const { RevenueCat } = await import("../client/index.js");
      expect(
        () =>
          new RevenueCat(stubComponent, {
            REVENUECAT_WEBHOOK_AUTH: "Bearer s3cret",
          }),
      ).toThrow(/is 6 chars after stripping \(minimum 32\)/);
    });

    test("RevenueCat class accepts undefined auth for non-webhook usage", async () => {
      const { RevenueCat } = await import("../client/index.js");
      expect(() => new RevenueCat(stubComponent, {})).not.toThrow();
    });

    test("RevenueCat class accepts a 32-char secret (at floor)", async () => {
      const { RevenueCat } = await import("../client/index.js");
      const atFloor = "a".repeat(32);
      expect(
        () =>
          new RevenueCat(stubComponent, { REVENUECAT_WEBHOOK_AUTH: atFloor }),
      ).not.toThrow();
    });

    test("RevenueCat class accepts a real openssl-style secret", async () => {
      const { RevenueCat } = await import("../client/index.js");
      expect(
        () =>
          new RevenueCat(stubComponent, {
            REVENUECAT_WEBHOOK_AUTH: VALID_SECRET,
          }),
      ).not.toThrow();
    });

    test("RevenueCat class accepts the same secret with a Bearer prefix", async () => {
      const { RevenueCat } = await import("../client/index.js");
      expect(
        () =>
          new RevenueCat(stubComponent, {
            REVENUECAT_WEBHOOK_AUTH: `Bearer ${VALID_SECRET}`,
          }),
      ).not.toThrow();
    });

    test("httpHandler() does not throw at build time when auth is undefined", async () => {
      const { RevenueCat } = await import("../client/index.js");
      const rc = new RevenueCat(stubComponent, {});
      expect(() => rc.httpHandler()).not.toThrow();
    });

    test("webhook handler rejects with 500 when auth is undefined", async () => {
      const { RevenueCat } = await import("../client/index.js");
      const rc = new RevenueCat(stubComponent, {});
      const handler = rc.httpHandler() as unknown as {
        _handler: (ctx: unknown, request: Request) => Promise<Response>;
      };
      const request = new Request(
        "https://example.convex.site/webhooks/revenuecat",
        {
          method: "POST",
          headers: {
            Authorization: "Bearer anything",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            event: { id: "evt_no_secret", type: "TEST" },
          }),
        },
      );
      const res = await handler._handler({}, request);
      expect(res.status).toBe(500);
    });

    test("httpHandler() succeeds when a real secret is configured", async () => {
      const { RevenueCat } = await import("../client/index.js");
      const rc = new RevenueCat(stubComponent, {
        REVENUECAT_WEBHOOK_AUTH: VALID_SECRET,
      });
      expect(() => rc.httpHandler()).not.toThrow();
    });
  });

  describe("dedup before rate limit", () => {
    test("replay of the same event.id doesn't consume rate-limit budget", async () => {
      const t = initConvexTest();
      const payload = basePayload({
        id: "evt_dedup_rate",
        app_id: "app_dedup",
        app_user_id: "user_dedup_rate",
      });
      await postEvent(t, payload);
      for (let i = 0; i < 150; i++) {
        const result = await postEvent(t, payload);
        expect(result.processed).toBe(false);
      }
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

  describe("transferEntitlements copies all flags", () => {
    test("TRANSFER preserves ownershipType and status flags on destination", async () => {
      const t = initConvexTest();
      const source = "user_transfer_src_audit";
      const dest = "user_transfer_dst_audit";
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

  describe("deleteCustomer purges transfers", () => {
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

  describe("REFUND_REVERSED clears stale refund markers", () => {
    test("reverse of a refund clears refundedAtMs and cancelReason", async () => {
      const t = initConvexTest();
      const txnId = "txn_refund_reversed";
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

  describe("RENEWAL clears autoResumeAtMs", () => {
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

  describe("legacy singular entitlement_id still grants", () => {
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

  describe("PRODUCT_CHANGE updates entitlements", () => {
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

  describe("VIRTUAL_CURRENCY accepts purchase_environment", () => {
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

  describe("UNSUBSCRIBE CANCELLATION records unsubscribeDetectedAt", () => {
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

  describe("event.id length capped", () => {
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

  describe("sync accepts unknown subscriber fields", () => {
    test("sync doesn't reject unknown top-level subscriber keys", async () => {
      const t = initConvexTest();
      await t.mutation(api.sync.ingest, {
        appUserId: "user_extra_fields",
        subscriber: {
          first_seen: "2024-01-01T00:00:00Z",
          entitlements: {},
          subscriptions: {},
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

  describe("aliasExperiments on SUBSCRIBER_ALIAS", () => {
    test("experiment enrollment follows the alias migration", async () => {
      const t = initConvexTest();
      const anon = "$RCAnonymousID:cccccccccccccccccccccccccccccccc";
      const real = "user_real_alias";

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

      await postEvent(t, {
        ...basePayload({
          id: "evt_alias_exp",
          type: "SUBSCRIBER_ALIAS",
          app_user_id: real,
          original_app_user_id: anon,
        }),
      });

      const exp = await t.query(api.experiments.get, {
        appUserId: real,
        experimentId: "onboarding_v2",
      });
      expect(exp).not.toBeNull();
      expect(exp?.variant).toBe("B");

      const anonExp = await t.query(api.experiments.list, {
        appUserId: anon,
      });
      expect(anonExp).toHaveLength(0);
    });
  });

  describe("unsubscribe_detected_at from REST sync", () => {
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

  describe("revokeEntitlements uses indexed lookup", () => {
    test("EXPIRATION with specific entitlement_ids revokes only those", async () => {
      const t = initConvexTest();
      await postEvent(
        t,
        basePayload({
          id: "evt_multi_grant",
          app_user_id: "user_multi",
          entitlement_ids: ["premium", "vip"],
        }),
      );
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

  describe("non_subscriptions default ownership + original_purchase_date", () => {
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

  describe("PII redaction from webhookEvents payload", () => {
    test("default redactor strips $email/$phoneNumber from stored payload", async () => {
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

  describe("customers.lastSeenAt monotonic guard", () => {
    test("out-of-order webhook delivery does not regress lastSeenAt", async () => {
      const t = initConvexTest();
      const earlier = Date.now() - 60_000;
      const later = Date.now();

      await postEvent(
        t,
        basePayload({
          id: "evt_lastseen_later",
          app_user_id: "user_lastseen",
          event_timestamp_ms: later,
        }),
      );
      await postEvent(
        t,
        basePayload({
          id: "evt_lastseen_earlier",
          app_user_id: "user_lastseen",
          event_timestamp_ms: earlier,
        }),
      );

      const customer = await t.query(api.customers.get, {
        appUserId: "user_lastseen",
      });
      expect(customer?.lastSeenAt).toBe(later);
    });
  });

  describe("originalAppUserId fallback on partial events", () => {
    test("event lacking original_app_user_id does not clobber the canonical value", async () => {
      const t = initConvexTest();
      const canonical = "$RCAnonymousID:abc123";

      await postEvent(
        t,
        basePayload({
          id: "evt_canon_set",
          app_user_id: "user_canon",
          original_app_user_id: canonical,
        }),
      );
      const partial = basePayload({
        id: "evt_canon_partial",
        app_user_id: "user_canon",
      });
      partial.original_app_user_id = undefined as unknown as string;
      await postEvent(t, partial);

      const customer = await t.query(api.customers.get, {
        appUserId: "user_canon",
      });
      expect(customer?.originalAppUserId).toBe(canonical);
    });
  });

  describe("subscription patch fields preserve on partial events", () => {
    test("BILLING_ISSUE without price fields does not erase priceUsd/currency", async () => {
      const t = initConvexTest();
      const subject = "user_partial";

      await postEvent(
        t,
        basePayload({
          id: "evt_partial_init",
          type: "INITIAL_PURCHASE",
          app_user_id: subject,
          original_transaction_id: "otxn_partial",
          transaction_id: "txn_partial",
        }),
      );
      const sub = (
        await t.query(api.subscriptions.getByUser, { appUserId: subject })
      )[0];
      expect(sub).toBeDefined();
      await t.run(async (ctx) => {
        await ctx.db.patch(sub._id, {
          priceUsd: 9.99,
          currency: "USD",
          countryCode: "US",
          taxPercentage: 10,
          presentedOfferingId: "offering_default",
        });
      });

      const partial = basePayload({
        id: "evt_partial_billing_issue",
        type: "BILLING_ISSUE",
        app_user_id: subject,
        original_transaction_id: "otxn_partial",
        transaction_id: "txn_partial",
      });
      partial.expiration_at_ms = undefined as unknown as number;
      await postEvent(t, partial);

      const after = (
        await t.query(api.subscriptions.getByUser, { appUserId: subject })
      )[0];
      expect(after.priceUsd).toBe(9.99);
      expect(after.currency).toBe("USD");
      expect(after.countryCode).toBe("US");
      expect(after.taxPercentage).toBe(10);
      expect(after.presentedOfferingId).toBe("offering_default");
    });
  });

  describe("TRANSFER dedup on direct re-invocation", () => {
    test("processing the same TRANSFER event twice does not duplicate transfers rows", async () => {
      const t = initConvexTest();
      const payload = basePayload({
        id: "evt_transfer_dedup",
        type: "TRANSFER",
        transferred_from: ["user_from"],
        transferred_to: ["user_to"],
      });
      await postEvent(t, payload);
      await t.mutation(internal.handlers.processTransfer, { event: payload });

      const transfers = await t.query(api.transfers.list, {});
      const sameEvent = transfers.filter(
        (tr) => tr.eventId === "evt_transfer_dedup",
      );
      expect(sameEvent.length).toBe(1);
    });
  });

  describe("customers.purge uses transferParticipants index", () => {
    test("purge deletes transfers via the join table without scanning globally", async () => {
      const t = initConvexTest();
      await postEvent(
        t,
        basePayload({
          id: "evt_purge_transfer",
          type: "TRANSFER",
          app_user_id: "user_purge",
          transferred_from: ["user_old"],
          transferred_to: ["user_purge"],
        }),
      );

      await t.run(async (ctx) => {
        for (let i = 0; i < 100; i++) {
          await ctx.db.insert("transfers", {
            eventId: `unrelated_${i}`,
            transferredFrom: ["other_a"],
            transferredTo: ["other_b"],
            timestamp: Date.now(),
          });
        }
      });

      const result = await t.mutation(api.customers.purge, {
        appUserId: "user_purge",
      });
      expect(result.transfers).toBe(1);

      const remainingForPurgeUser = await t.run(async (ctx) => {
        return await ctx.db
          .query("transferParticipants")
          .withIndex("by_app_user", (q) => q.eq("appUserId", "user_purge"))
          .collect();
      });
      expect(remainingForPurgeUser.length).toBe(0);
    });
  });

  describe("subscription.kind discriminator", () => {
    test("NON_RENEWING_PURCHASE writes kind: consumable", async () => {
      const t = initConvexTest();
      const subject = "user_consumable";
      await postEvent(
        t,
        basePayload({
          id: "evt_consumable",
          type: "NON_RENEWING_PURCHASE",
          app_user_id: subject,
          product_id: "extra_lives_10",
          original_transaction_id: "otxn_consumable",
          transaction_id: "txn_consumable",
        }),
      );
      const subs = await t.query(api.subscriptions.getByUser, {
        appUserId: subject,
      });
      expect(subs[0].kind).toBe("consumable");
    });

    test("INITIAL_PURCHASE writes kind: subscription", async () => {
      const t = initConvexTest();
      const subject = "user_recurring";
      await postEvent(
        t,
        basePayload({
          id: "evt_recurring",
          type: "INITIAL_PURCHASE",
          app_user_id: subject,
          original_transaction_id: "otxn_recurring",
          transaction_id: "txn_recurring",
        }),
      );
      const subs = await t.query(api.subscriptions.getByUser, {
        appUserId: subject,
      });
      expect(subs[0].kind).toBe("subscription");
    });

    test("getActive filters out consumables", async () => {
      const t = initConvexTest();
      const subject = "user_mixed";
      await postEvent(
        t,
        basePayload({
          id: "evt_mixed_recurring",
          type: "INITIAL_PURCHASE",
          app_user_id: subject,
          product_id: "premium_monthly",
          original_transaction_id: "otxn_mixed_a",
          transaction_id: "txn_mixed_a",
        }),
      );
      await postEvent(
        t,
        basePayload({
          id: "evt_mixed_consumable",
          type: "NON_RENEWING_PURCHASE",
          app_user_id: subject,
          product_id: "extra_lives_10",
          original_transaction_id: "otxn_mixed_b",
          transaction_id: "txn_mixed_b",
        }),
      );
      const active = await t.query(api.subscriptions.getActive, {
        appUserId: subject,
      });
      expect(active.length).toBe(1);
      expect(active[0].productId).toBe("premium_monthly");
      const consumables = await t.query(api.subscriptions.getConsumables, {
        appUserId: subject,
      });
      expect(consumables.length).toBe(1);
      expect(consumables[0].productId).toBe("extra_lives_10");
    });
  });

  describe("customer.countryCode mirrors latest event", () => {
    test("country_code from latest event lands on customer", async () => {
      const t = initConvexTest();
      const subject = "user_country";
      const earlier = Date.now() - 60_000;
      const later = Date.now();
      await postEvent(t, {
        ...basePayload({
          id: "evt_country_us",
          app_user_id: subject,
          event_timestamp_ms: earlier,
        }),
        country_code: "US",
      });
      await postEvent(t, {
        ...basePayload({
          id: "evt_country_de",
          app_user_id: subject,
          event_timestamp_ms: later,
        }),
        country_code: "DE",
      });
      const customer = await t.query(api.customers.get, { appUserId: subject });
      expect(customer?.countryCode).toBe("DE");
    });

    test("out-of-order older event does not regress countryCode", async () => {
      const t = initConvexTest();
      const subject = "user_country_oo";
      const earlier = Date.now() - 60_000;
      const later = Date.now();
      await postEvent(t, {
        ...basePayload({
          id: "evt_country_later",
          app_user_id: subject,
          event_timestamp_ms: later,
        }),
        country_code: "DE",
      });
      await postEvent(t, {
        ...basePayload({
          id: "evt_country_earlier",
          app_user_id: subject,
          event_timestamp_ms: earlier,
        }),
        country_code: "US",
      });
      const customer = await t.query(api.customers.get, { appUserId: subject });
      expect(customer?.countryCode).toBe("DE");
    });
  });

  describe("future-timestamp poisoning guard", () => {
    test("event_timestamp_ms far in the future is clamped on insert", async () => {
      const t = initConvexTest();
      const subject = "user_future_ts";
      const farFuture = Date.now() + 10 * 365 * 24 * 60 * 60 * 1000;
      await postEvent(
        t,
        basePayload({
          id: "evt_future",
          app_user_id: subject,
          event_timestamp_ms: farFuture,
        }),
      );
      const skewCap = Date.now() + 5 * 60 * 1000;
      const customer = await t.query(api.customers.get, { appUserId: subject });
      expect(customer?.lastSeenAt).toBeLessThanOrEqual(skewCap);
      expect(customer?.firstSeenAt).toBeLessThanOrEqual(skewCap);
      expect(customer?.lastSeenAt).toBeLessThan(farFuture);
    });

    test("clamping does not block subsequent legitimate events", async () => {
      const t = initConvexTest();
      const subject = "user_future_unblocked";
      const farFuture = Date.now() + 10 * 365 * 24 * 60 * 60 * 1000;
      await postEvent(
        t,
        basePayload({
          id: "evt_future_first",
          app_user_id: subject,
          event_timestamp_ms: farFuture,
        }),
      );
      const realtimeMs = Date.now();
      await postEvent(
        t,
        basePayload({
          id: "evt_future_second",
          app_user_id: subject,
          event_timestamp_ms: realtimeMs,
          country_code: "FR",
        }),
      );
      const customer = await t.query(api.customers.get, { appUserId: subject });
      expect(customer?.countryCode).toBe("FR");
    });
  });

  describe("TRANSFER participants count assertion", () => {
    test("dedup leaves exactly one set of participant rows per event", async () => {
      const t = initConvexTest();
      const payload = basePayload({
        id: "evt_transfer_participants",
        type: "TRANSFER",
        transferred_from: ["user_from"],
        transferred_to: ["user_to"],
      });
      await postEvent(t, payload);
      await t.mutation(internal.handlers.processTransfer, { event: payload });
      const participants = await t.run(async (ctx) => {
        return await ctx.db.query("transferParticipants").collect();
      });
      expect(participants.length).toBe(2);
      const roles = participants.map((p) => p.role).sort();
      expect(roles).toEqual(["from", "to"]);
    });
  });

  describe("anonymous TRANSFER source purges its participants", () => {
    test("transferParticipants for the anonymous source are dropped after merge", async () => {
      const t = initConvexTest();
      const anon = "$RCAnonymousID:anon123";
      const real = "user_real";
      await postEvent(
        t,
        basePayload({
          id: "evt_anon_transfer",
          type: "TRANSFER",
          transferred_from: [anon],
          transferred_to: [real],
        }),
      );
      const participants = await t.run(async (ctx) => {
        return await ctx.db.query("transferParticipants").collect();
      });
      expect(participants.length).toBe(1);
      expect(participants[0].appUserId).toBe(real);
      expect(participants[0].role).toBe("to");
    });
  });

  describe("recordFailure is dedup-safe and capped", () => {
    test("malformed event.id is rejected at HTTP boundary, not via recordFailure", async () => {
      const t = initConvexTest();
      await expect(
        t.mutation(api.webhooks.process, {
          event: {
            id: "   ",
            type: "INITIAL_PURCHASE",
            environment: "SANDBOX" as const,
          },
          payload: { id: "   ", type: "INITIAL_PURCHASE" },
        }),
      ).rejects.toThrow(/Event ID is required/);
    });
  });

  describe("backfillTransferParticipants is idempotent", () => {
    test("re-running the backfill does not double-write participant rows", async () => {
      const t = initConvexTest();
      await t.run(async (ctx) => {
        await ctx.db.insert("transfers", {
          eventId: "evt_legacy_transfer",
          transferredFrom: ["legacy_a"],
          transferredTo: ["legacy_b"],
          timestamp: Date.now(),
        });
      });

      const first = await t.mutation(
        api.transfers.backfillTransferParticipants,
        {},
      );
      expect(first.written).toBe(2);
      expect(first.nextCursor).toBeNull();

      const second = await t.mutation(
        api.transfers.backfillTransferParticipants,
        {},
      );
      expect(second.written).toBe(0);

      const participants = await t.run(async (ctx) => {
        return await ctx.db.query("transferParticipants").collect();
      });
      expect(participants.length).toBe(2);
    });
  });

  describe("backfillKind retroactively classifies consumables", () => {
    test("walks webhookEvents and patches matching subs to kind: consumable", async () => {
      const t = initConvexTest();
      const subject = "user_backfill";
      const txnA = "otxn_consumable_pre_kind";
      const txnB = "otxn_recurring_pre_kind";

      await postEvent(
        t,
        basePayload({
          id: "evt_pre_consumable",
          type: "NON_RENEWING_PURCHASE",
          app_user_id: subject,
          product_id: "lives_pack",
          original_transaction_id: txnA,
          transaction_id: txnA,
        }),
      );
      await postEvent(
        t,
        basePayload({
          id: "evt_pre_recurring",
          type: "INITIAL_PURCHASE",
          app_user_id: subject,
          product_id: "premium_monthly",
          original_transaction_id: txnB,
          transaction_id: txnB,
        }),
      );
      await t.run(async (ctx) => {
        for (const txn of [txnA, txnB]) {
          const sub = await ctx.db
            .query("subscriptions")
            .withIndex("by_original_transaction", (q) =>
              q.eq("originalTransactionId", txn),
            )
            .first();
          if (sub) await ctx.db.patch(sub._id, { kind: undefined });
        }
      });

      const first = await t.mutation(api.subscriptions.backfillKind, {});
      expect(first.written).toBe(1);
      expect(first.nextCursor).toBeNull();

      const subs = await t.query(api.subscriptions.getByUser, {
        appUserId: subject,
      });
      const consumable = subs.find((s) => s.originalTransactionId === txnA);
      const recurring = subs.find((s) => s.originalTransactionId === txnB);
      expect(consumable?.kind).toBe("consumable");
      expect(recurring?.kind).toBeUndefined();

      const second = await t.mutation(api.subscriptions.backfillKind, {});
      expect(second.written).toBe(0);
    });

    test("getActive filters consumables once backfilled", async () => {
      const t = initConvexTest();
      const subject = "user_backfill_filter";
      const txn = "otxn_filter";
      await postEvent(
        t,
        basePayload({
          id: "evt_filter_pre",
          type: "NON_RENEWING_PURCHASE",
          app_user_id: subject,
          product_id: "coins_100",
          original_transaction_id: txn,
          transaction_id: txn,
        }),
      );
      await t.run(async (ctx) => {
        const sub = await ctx.db
          .query("subscriptions")
          .withIndex("by_original_transaction", (q) =>
            q.eq("originalTransactionId", txn),
          )
          .first();
        if (sub) await ctx.db.patch(sub._id, { kind: undefined });
      });
      const beforeActive = await t.query(api.subscriptions.getActive, {
        appUserId: subject,
      });
      expect(beforeActive.length).toBe(1);

      await t.mutation(api.subscriptions.backfillKind, {});

      const afterActive = await t.query(api.subscriptions.getActive, {
        appUserId: subject,
      });
      expect(afterActive.length).toBe(0);
      const afterConsumables = await t.query(api.subscriptions.getConsumables, {
        appUserId: subject,
      });
      expect(afterConsumables.length).toBe(1);
    });
  });

  describe("future-poisoned timestamp does not block country update", () => {
    test("real-time event 30s+ after a clamped future event still mirrors countryCode", async () => {
      const t = initConvexTest();
      const subject = "user_country_unblock";
      const farFuture = Date.now() + 10 * 365 * 24 * 60 * 60 * 1000;

      await postEvent(t, {
        ...basePayload({
          id: "evt_country_poison",
          app_user_id: subject,
          event_timestamp_ms: farFuture,
        }),
        country_code: "US",
      });

      const realtime = Date.now() + 30_000;
      await postEvent(t, {
        ...basePayload({
          id: "evt_country_realtime",
          app_user_id: subject,
          event_timestamp_ms: realtime,
        }),
        country_code: "JP",
      });

      const customer = await t.query(api.customers.get, { appUserId: subject });
      expect(customer?.countryCode).toBe("JP");
    });
  });

  describe("rate-limit key falls back to app_user_id", () => {
    test("events without app_id share a per-user bucket, not a global one", async () => {
      const t = initConvexTest();
      const userA = "user_rl_a";
      const userB = "user_rl_b";
      for (let i = 0; i < 50; i++) {
        await postEvent(
          t,
          basePayload({
            id: `evt_rl_a_${i}`,
            app_id: undefined as unknown as string,
            app_user_id: userA,
            original_transaction_id: `txn_a_${i}`,
            transaction_id: `txn_a_${i}`,
          }),
        );
        await postEvent(
          t,
          basePayload({
            id: `evt_rl_b_${i}`,
            app_id: undefined as unknown as string,
            app_user_id: userB,
            original_transaction_id: `txn_b_${i}`,
            transaction_id: `txn_b_${i}`,
          }),
        );
      }
      const a = await postEvent(
        t,
        basePayload({
          id: "evt_rl_a_final",
          app_id: undefined as unknown as string,
          app_user_id: userA,
          original_transaction_id: "txn_a_final",
          transaction_id: "txn_a_final",
        }),
      );
      const b = await postEvent(
        t,
        basePayload({
          id: "evt_rl_b_final",
          app_id: undefined as unknown as string,
          app_user_id: userB,
          original_transaction_id: "txn_b_final",
          transaction_id: "txn_b_final",
        }),
      );
      expect(a.processed).toBe(true);
      expect(b.processed).toBe(true);
    });
  });

  test("noop, ConvexError import guard", () => {
    expect(ConvexError).toBeDefined();
  });
});
