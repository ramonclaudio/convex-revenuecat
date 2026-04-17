/// <reference types="vite/client" />

import { createFunctionHandle } from "convex/server";
import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api.js";
import { initConvexTest } from "./setup.test.js";

// Resolve a FunctionReference to a FunctionHandle string inside a Convex
// context. The client SDK does this for consumers; tests call the mutations
// directly, so we need the equivalent here.
async function handleFor(
  t: ReturnType<typeof initConvexTest>,
  ref: Parameters<typeof createFunctionHandle>[0],
): Promise<string> {
  return await t.run(async () => createFunctionHandle(ref));
}

// Hooks are FunctionReferences — consumers pass any valid internal or public
// mutation/action. These tests stand up the hook target as an `internalAction`
// declared in `hookTargets.test.ts` (loaded via the import.meta.glob) and
// assert that the scheduler queued a call by peeking at `_scheduled_functions`.

type ScheduledJob = {
  name: string;
  args: Record<string, unknown>;
  state: { kind: string };
};

async function scheduledJobsMatching(
  t: ReturnType<typeof initConvexTest>,
  nameSuffix: string,
): Promise<ScheduledJob[]> {
  return await t.run(async (ctx) => {
    const jobs = await ctx.db.system
      .query("_scheduled_functions")
      .collect();
    return jobs
      .filter((j) => j.name.endsWith(nameSuffix))
      .map((j) => ({
        name: j.name,
        args: (Array.isArray(j.args) ? j.args[0] : j.args) as Record<string, unknown>,
        state: j.state,
      }));
  });
}

function createPurchasePayload(overrides: {
  id: string;
  app_user_id: string;
  entitlement_ids?: string[];
  expiration_at_ms?: number;
  type?: string;
  original_transaction_id?: string;
  product_id?: string;
}) {
  return {
    type: overrides.type ?? "INITIAL_PURCHASE",
    id: overrides.id,
    app_id: "app_hooks",
    app_user_id: overrides.app_user_id,
    original_app_user_id: overrides.app_user_id,
    aliases: [],
    event_timestamp_ms: Date.now(),
    product_id: overrides.product_id ?? "premium_monthly",
    entitlement_ids: overrides.entitlement_ids ?? ["premium"],
    period_type: "NORMAL" as const,
    purchased_at_ms: Date.now(),
    expiration_at_ms:
      overrides.expiration_at_ms ?? Date.now() + 30 * 24 * 60 * 60 * 1000,
    transaction_id: `txn_${overrides.id}`,
    original_transaction_id:
      overrides.original_transaction_id ?? `txn_original_${overrides.id}`,
    store: "APP_STORE" as const,
    environment: "SANDBOX" as const,
    is_family_share: false,
  };
}

describe("lifecycle hooks", () => {
  describe("onEntitlementActivated", () => {
    test("fires on INITIAL_PURCHASE for each granted entitlement", async () => {
      const t = initConvexTest();
      const handle = await handleFor(t, internal.handlers.processTest);
      const payload = createPurchasePayload({
        id: "evt_hook_initial",
        app_user_id: "user_hook_initial",
        entitlement_ids: ["premium", "pro"],
      });

      await t.mutation(api.webhooks.process, {
        event: {
          id: payload.id,
          type: payload.type,
          app_user_id: payload.app_user_id,
          environment: payload.environment,
          store: payload.store,
        },
        payload,
        hooks: {
          onEntitlementActivated: handle,
        },
      });

      const jobs = await scheduledJobsMatching(t, "processTest");
      expect(jobs).toHaveLength(2);
      const entIds = jobs
        .map((j) => (j.args as { entitlementId: string }).entitlementId)
        .sort();
      expect(entIds).toEqual(["premium", "pro"]);
      expect(
        (jobs[0].args as { appUserId: string }).appUserId,
      ).toBe("user_hook_initial");
      expect(
        (jobs[0].args as { productId?: string }).productId,
      ).toBe("premium_monthly");
    });

    test("does not fire when the entitlement was already active", async () => {
      const t = initConvexTest();
      const handle = await handleFor(t, internal.handlers.processTest);
      const userId = "user_hook_already_active";

      // First purchase activates.
      await t.mutation(api.webhooks.process, {
        event: {
          id: "evt_hook_a1",
          type: "INITIAL_PURCHASE",
          app_user_id: userId,
          environment: "SANDBOX",
          store: "APP_STORE",
        },
        payload: createPurchasePayload({ id: "evt_hook_a1", app_user_id: userId }),
      });

      // Second event with the same entitlement but NEW transaction id shouldn't
      // double-fire the hook (state is already active).
      await t.mutation(api.webhooks.process, {
        event: {
          id: "evt_hook_a2",
          type: "RENEWAL",
          app_user_id: userId,
          environment: "SANDBOX",
          store: "APP_STORE",
        },
        payload: createPurchasePayload({
          id: "evt_hook_a2",
          app_user_id: userId,
          type: "RENEWAL",
          original_transaction_id: "txn_original_evt_hook_a1",
        }),
        hooks: {
          onEntitlementActivated: handle,
        },
      });

      const jobs = await scheduledJobsMatching(t, "processTest");
      expect(jobs).toHaveLength(0);
    });

    test("does not fire when the same webhook is retried (dedup)", async () => {
      const t = initConvexTest();
      const handle = await handleFor(t, internal.handlers.processTest);
      const payload = createPurchasePayload({
        id: "evt_hook_dedup",
        app_user_id: "user_hook_dedup",
      });

      // First delivery activates + fires hook.
      await t.mutation(api.webhooks.process, {
        event: {
          id: payload.id,
          type: payload.type,
          app_user_id: payload.app_user_id,
          environment: payload.environment,
          store: payload.store,
        },
        payload,
        hooks: { onEntitlementActivated: handle },
      });

      // RC retries — same event.id. The outer mutation short-circuits via
      // the webhookEvents dedup check; no snapshot or hook fires on retry.
      await t.mutation(api.webhooks.process, {
        event: {
          id: payload.id,
          type: payload.type,
          app_user_id: payload.app_user_id,
          environment: payload.environment,
          store: payload.store,
        },
        payload,
        hooks: { onEntitlementActivated: handle },
      });

      const jobs = await scheduledJobsMatching(t, "processTest");
      expect(jobs).toHaveLength(1);
    });
  });

  describe("onEntitlementDeactivated", () => {
    test("fires on EXPIRATION", async () => {
      const t = initConvexTest();
      const handle = await handleFor(t, internal.handlers.processTest);
      const userId = "user_hook_expire";

      await t.mutation(api.webhooks.process, {
        event: {
          id: "evt_hook_e1",
          type: "INITIAL_PURCHASE",
          app_user_id: userId,
          environment: "SANDBOX",
          store: "APP_STORE",
        },
        payload: createPurchasePayload({ id: "evt_hook_e1", app_user_id: userId }),
      });

      const expirePayload = createPurchasePayload({
        id: "evt_hook_e2",
        app_user_id: userId,
        type: "EXPIRATION",
        expiration_at_ms: Date.now() - 1000,
        original_transaction_id: "txn_original_evt_hook_e1",
      });
      await t.mutation(api.webhooks.process, {
        event: {
          id: expirePayload.id,
          type: expirePayload.type,
          app_user_id: expirePayload.app_user_id,
          environment: expirePayload.environment,
          store: expirePayload.store,
        },
        payload: expirePayload,
        hooks: { onEntitlementDeactivated: handle },
      });

      const jobs = await scheduledJobsMatching(t, "processTest");
      expect(jobs).toHaveLength(1);
      expect(
        (jobs[0].args as { entitlementId: string }).entitlementId,
      ).toBe("premium");
      expect((jobs[0].args as { appUserId: string }).appUserId).toBe(userId);
    });

    test("fires on refund CANCELLATION with CUSTOMER_SUPPORT", async () => {
      const t = initConvexTest();
      const handle = await handleFor(t, internal.handlers.processTest);
      const userId = "user_hook_refund";

      await t.mutation(api.webhooks.process, {
        event: {
          id: "evt_hook_r1",
          type: "INITIAL_PURCHASE",
          app_user_id: userId,
          environment: "SANDBOX",
          store: "APP_STORE",
        },
        payload: createPurchasePayload({ id: "evt_hook_r1", app_user_id: userId }),
      });

      const cancelPayload = {
        ...createPurchasePayload({
          id: "evt_hook_r2",
          app_user_id: userId,
          type: "CANCELLATION",
          original_transaction_id: "txn_original_evt_hook_r1",
        }),
        cancel_reason: "CUSTOMER_SUPPORT",
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
        hooks: { onEntitlementDeactivated: handle },
      });

      const jobs = await scheduledJobsMatching(t, "processTest");
      expect(jobs).toHaveLength(1);
    });
  });

  describe("onEntitlementActivated + Deactivated together", () => {
    test("TRANSFER fires deactivate for source and activate for destination", async () => {
      const t = initConvexTest();
      const handle = await handleFor(t, internal.handlers.processTest);
      const source = "user_transfer_src";
      const dest = "user_transfer_dst";

      await t.mutation(api.webhooks.process, {
        event: {
          id: "evt_t_seed",
          type: "INITIAL_PURCHASE",
          app_user_id: source,
          environment: "SANDBOX",
          store: "APP_STORE",
        },
        payload: createPurchasePayload({ id: "evt_t_seed", app_user_id: source }),
      });

      await t.mutation(api.webhooks.process, {
        event: {
          id: "evt_transfer",
          type: "TRANSFER",
          app_id: "app_hooks",
          environment: "SANDBOX",
          store: "APP_STORE",
        },
        payload: {
          id: "evt_transfer",
          type: "TRANSFER",
          event_timestamp_ms: Date.now(),
          store: "APP_STORE",
          environment: "SANDBOX",
          transferred_from: [source],
          transferred_to: [dest],
          entitlement_ids: ["premium"],
        },
        hooks: {
          onEntitlementActivated: handle,
          onEntitlementDeactivated: handle,
        },
      });

      const jobs = await scheduledJobsMatching(t, "processTest");
      const users = jobs.map((j) => (j.args as { appUserId: string }).appUserId).sort();
      expect(users).toEqual([dest, source]);
    });
  });

  describe("sync path", () => {
    test("fires hooks when sync flips an entitlement active", async () => {
      const t = initConvexTest();
      const handle = await handleFor(t, internal.handlers.processTest);

      await t.mutation(api.sync.ingest, {
        appUserId: "user_sync_hook",
        subscriber: {
          first_seen: "2024-01-01T00:00:00Z",
          entitlements: {
            premium: {
              expires_date: new Date(Date.now() + 86400000).toISOString(),
              product_identifier: "monthly",
              purchase_date: "2024-01-01T00:00:00Z",
            },
          },
          subscriptions: {
            monthly: {
              store: "APP_STORE",
              is_sandbox: false,
              period_type: "normal",
              expires_date: new Date(Date.now() + 86400000).toISOString(),
              purchase_date: "2024-01-01T00:00:00Z",
              original_purchase_date: "2024-01-01T00:00:00Z",
              store_transaction_id: "txn_sync_hook",
            },
          },
        },
        hooks: { onEntitlementActivated: handle },
      });

      const jobs = await scheduledJobsMatching(t, "processTest");
      expect(jobs).toHaveLength(1);
      expect(
        (jobs[0].args as { entitlementId: string }).entitlementId,
      ).toBe("premium");
    });

    test("fires deactivate hook when sync catches an expired entitlement", async () => {
      const t = initConvexTest();
      const handle = await handleFor(t, internal.handlers.processTest);
      const userId = "user_sync_expire";

      // First sync activates.
      await t.mutation(api.sync.ingest, {
        appUserId: userId,
        subscriber: {
          first_seen: "2024-01-01T00:00:00Z",
          entitlements: {
            premium: {
              expires_date: new Date(Date.now() + 86400000).toISOString(),
              product_identifier: "monthly",
              purchase_date: "2024-01-01T00:00:00Z",
            },
          },
          subscriptions: {
            monthly: {
              store: "APP_STORE",
              is_sandbox: false,
              period_type: "normal",
              expires_date: new Date(Date.now() + 86400000).toISOString(),
              purchase_date: "2024-01-01T00:00:00Z",
              original_purchase_date: "2024-01-01T00:00:00Z",
              store_transaction_id: "txn_sync_exp",
            },
          },
        },
      });

      // Second sync shows entitlement expired.
      await t.mutation(api.sync.ingest, {
        appUserId: userId,
        subscriber: {
          first_seen: "2024-01-01T00:00:00Z",
          entitlements: {
            premium: {
              expires_date: new Date(Date.now() - 1000).toISOString(),
              product_identifier: "monthly",
              purchase_date: "2024-01-01T00:00:00Z",
            },
          },
          subscriptions: {
            monthly: {
              store: "APP_STORE",
              is_sandbox: false,
              period_type: "normal",
              expires_date: new Date(Date.now() - 1000).toISOString(),
              purchase_date: "2024-01-01T00:00:00Z",
              original_purchase_date: "2024-01-01T00:00:00Z",
              store_transaction_id: "txn_sync_exp",
            },
          },
        },
        hooks: { onEntitlementDeactivated: handle },
      });

      const jobs = await scheduledJobsMatching(t, "processTest");
      expect(jobs).toHaveLength(1);
      expect(
        (jobs[0].args as { entitlementId: string }).entitlementId,
      ).toBe("premium");
    });
  });

  describe("onCustomerDeleted", () => {
    test("fires after purge", async () => {
      const t = initConvexTest();
      const handle = await handleFor(t, internal.handlers.processTest);

      await t.mutation(api.webhooks.process, {
        event: {
          id: "evt_purge_seed",
          type: "INITIAL_PURCHASE",
          app_user_id: "user_purge_hook",
          environment: "SANDBOX",
          store: "APP_STORE",
        },
        payload: createPurchasePayload({
          id: "evt_purge_seed",
          app_user_id: "user_purge_hook",
        }),
      });

      await t.mutation(api.customers.purge, {
        appUserId: "user_purge_hook",
        onCustomerDeleted: handle,
      });

      const jobs = await scheduledJobsMatching(t, "processTest");
      expect(jobs).toHaveLength(1);
      expect(
        (jobs[0].args as { appUserId: string }).appUserId,
      ).toBe("user_purge_hook");
    });

    test("does not fire when hook is omitted", async () => {
      const t = initConvexTest();

      await t.mutation(api.customers.purge, { appUserId: "ghost_user" });

      const jobs = await scheduledJobsMatching(t, "processTest");
      expect(jobs).toHaveLength(0);
    });
  });

  describe("hook absence", () => {
    test("webhook processes normally with no hooks configured", async () => {
      const t = initConvexTest();
      const payload = createPurchasePayload({
        id: "evt_no_hooks",
        app_user_id: "user_no_hooks",
      });

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

      const jobs = await scheduledJobsMatching(t, "processTest");
      expect(jobs).toHaveLength(0);
    });
  });
});
