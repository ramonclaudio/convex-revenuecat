import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api.js";
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
  }> = {},
) {
  return {
    type: overrides.type ?? "INITIAL_PURCHASE",
    id: overrides.id ?? "evt_test",
    app_id: "app_123",
    app_user_id: overrides.app_user_id ?? "user_123",
    original_app_user_id: overrides.original_app_user_id ?? "user_123",
    aliases: [],
    event_timestamp_ms: Date.now(),
    product_id: overrides.product_id ?? "premium_monthly",
    entitlement_ids: overrides.entitlement_ids ?? ["premium"],
    period_type: "NORMAL" as const,
    purchased_at_ms: Date.now(),
    expiration_at_ms: overrides.expiration_at_ms ?? Date.now() + 30 * 24 * 60 * 60 * 1000,
    transaction_id: "txn_123",
    original_transaction_id: "txn_original_123",
    store: "APP_STORE" as const,
    environment: "SANDBOX" as const,
    is_family_share: false,
  };
}

describe("webhook validation", () => {
  test("throws when event ID is empty", async () => {
    const t = initConvexTest();

    const payload = createEventPayload({ id: "   " });

    await expect(
      t.mutation(api.webhooks.process, {
        event: {
          id: "   ",
          type: payload.type,
          environment: payload.environment,
        },
        payload,
      }),
    ).rejects.toThrow("Event ID is required");
  });

  test("throws when event type is empty", async () => {
    const t = initConvexTest();

    const payload = createEventPayload({ id: "evt_valid_id" });

    await expect(
      t.mutation(api.webhooks.process, {
        event: {
          id: "evt_valid_id",
          type: "   ",
          environment: payload.environment,
        },
        payload,
      }),
    ).rejects.toThrow("Event type is required");
  });
});

describe("webhook rate limiting", () => {
  test("throws after exceeding rate limit", async () => {
    const t = initConvexTest();

    for (let i = 0; i < 100; i++) {
      await t.mutation(internal.webhooks.checkRateLimit, {
        key: "webhook:app_rate_test",
      });
    }

    const result = await t.mutation(internal.webhooks.checkRateLimit, {
      key: "webhook:app_rate_test",
    });

    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
  });
});

describe("webhooks", () => {
  test("process logs event and returns processed=true", async () => {
    const t = initConvexTest();

    const payload = createEventPayload({ id: "evt_123" });

    const result = await t.mutation(api.webhooks.process, {
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

    expect(result.processed).toBe(true);
    expect(result.eventId).toBe("evt_123");
  });

  test("process is idempotent - same event returns processed=false", async () => {
    const t = initConvexTest();

    const payload = createEventPayload({ id: "evt_456", type: "RENEWAL" });

    const first = await t.mutation(api.webhooks.process, {
      event: {
        id: payload.id,
        type: payload.type,
        environment: payload.environment,
      },
      payload,
    });

    expect(first.processed).toBe(true);

    const second = await t.mutation(api.webhooks.process, {
      event: {
        id: payload.id,
        type: payload.type,
        environment: payload.environment,
      },
      payload,
    });

    expect(second.processed).toBe(false);
  });

  test("unknown event type returns processed=false but logs event", async () => {
    const t = initConvexTest();

    const payload = {
      id: "evt_unknown_1",
      type: "UNKNOWN_FUTURE_EVENT",
      event_timestamp_ms: Date.now(),
      app_user_id: "user_unknown",
      environment: "SANDBOX" as const,
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

    expect(result.processed).toBe(false);
    expect(result.eventId).toBe("evt_unknown_1");

    const secondResult = await t.mutation(api.webhooks.process, {
      event: {
        id: payload.id,
        type: payload.type,
        app_user_id: payload.app_user_id,
        environment: payload.environment,
      },
      payload,
    });

    expect(secondResult.processed).toBe(false);
  });
});
