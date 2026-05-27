/// <reference types="vite/client" />

// Set BEFORE http.ts loads. A present-but-short or malformed secret throws
// at construction. A missing secret is rejected per-request at runtime. The
// auth tests below need a valid configured secret.
const TEST_SECRET = "kZ9tQ1xH8mF3vR7yL2nP5sJ6cW0bD4gE8aT1iU4oY3w=";
process.env.REVENUECAT_WEBHOOK_AUTH = TEST_SECRET;

import { describe, expect, test } from "vitest";
import { initConvexTest } from "./setup.test.js";

const WEBHOOK_PATH = "/webhooks/revenuecat";

function eventBody(overrides: Partial<Record<string, unknown>> = {}) {
  const now = Date.now();
  return {
    api_version: "1.0",
    event: {
      type: "INITIAL_PURCHASE",
      id: `evt_http_${now}`,
      app_id: "app_http",
      app_user_id: "user_http",
      original_app_user_id: "user_http",
      aliases: [],
      event_timestamp_ms: now,
      product_id: "premium_monthly",
      entitlement_ids: ["premium"],
      period_type: "NORMAL",
      purchased_at_ms: now,
      expiration_at_ms: now + 30 * 24 * 60 * 60 * 1000,
      transaction_id: `txn_http_${now}`,
      original_transaction_id: `otxn_http_${now}`,
      store: "APP_STORE",
      environment: "SANDBOX",
      is_family_share: false,
      ...overrides,
    },
  };
}

function postJson(
  t: ReturnType<typeof initConvexTest>,
  body: unknown,
  headers: Record<string, string> = {},
) {
  return t.fetch(WEBHOOK_PATH, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

describe("httpHandler: webhook auth", () => {
  test("rejects request with no Authorization header", async () => {
    const t = initConvexTest();
    const res = await postJson(t, eventBody());
    expect(res.status).toBe(401);
  });

  test("rejects request with wrong token", async () => {
    const t = initConvexTest();
    const res = await postJson(t, eventBody(), {
      Authorization: "Bearer wrong-token-but-32-chars-aaaaaa",
    });
    expect(res.status).toBe(401);
  });

  test("rejects request with bare Bearer prefix (paste error)", async () => {
    const t = initConvexTest();
    const res = await postJson(t, eventBody(), { Authorization: "Bearer " });
    expect(res.status).toBe(401);
  });

  test("rejects request with empty Authorization", async () => {
    const t = initConvexTest();
    const res = await postJson(t, eventBody(), { Authorization: "" });
    expect(res.status).toBe(401);
  });

  test("accepts request with raw secret", async () => {
    const t = initConvexTest();
    const res = await postJson(t, eventBody(), { Authorization: TEST_SECRET });
    expect(res.status).toBe(200);
  });

  test("accepts request with Bearer-prefixed secret", async () => {
    const t = initConvexTest();
    const res = await postJson(t, eventBody(), {
      Authorization: `Bearer ${TEST_SECRET}`,
    });
    expect(res.status).toBe(200);
  });
});

describe("httpHandler: payload validation", () => {
  test("rejects invalid JSON body", async () => {
    const t = initConvexTest();
    const res = await t.fetch(WEBHOOK_PATH, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: TEST_SECRET,
      },
      body: "this is not json",
    });
    expect(res.status).toBe(400);
  });

  test("rejects body missing event field", async () => {
    const t = initConvexTest();
    const res = await postJson(
      t,
      { api_version: "1.0" },
      { Authorization: TEST_SECRET },
    );
    expect(res.status).toBe(400);
  });

  test("rejects whitespace-only event.id", async () => {
    const t = initConvexTest();
    const res = await postJson(t, eventBody({ id: "   " }), {
      Authorization: TEST_SECRET,
    });
    expect(res.status).toBe(400);
  });

  test("rejects empty event.type", async () => {
    const t = initConvexTest();
    const res = await postJson(t, eventBody({ type: "" }), {
      Authorization: TEST_SECRET,
    });
    expect(res.status).toBe(400);
  });

  test("rejects oversized event.id (>128 chars)", async () => {
    const t = initConvexTest();
    const res = await postJson(t, eventBody({ id: "x".repeat(129) }), {
      Authorization: TEST_SECRET,
    });
    expect(res.status).toBe(400);
  });

  test("rejects unknown environment value", async () => {
    const t = initConvexTest();
    const res = await postJson(t, eventBody({ environment: "UAT" }), {
      Authorization: TEST_SECRET,
    });
    expect(res.status).toBe(400);
  });
});

describe("httpHandler: body size cap", () => {
  test("rejects 413 when Content-Length exceeds 1MB", async () => {
    const t = initConvexTest();
    // Claim 2MB via Content-Length without actually sending the body.
    const res = await t.fetch(WEBHOOK_PATH, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": String(2 * 1024 * 1024),
        Authorization: TEST_SECRET,
      },
      body: JSON.stringify(eventBody()),
    });
    expect(res.status).toBe(413);
  });
});

describe("httpHandler: happy path response shape", () => {
  test("200 with processed=true on first delivery", async () => {
    const t = initConvexTest();
    const res = await postJson(t, eventBody({ id: "evt_happy" }), {
      Authorization: TEST_SECRET,
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { processed: boolean; eventId: string };
    expect(json.processed).toBe(true);
    expect(json.eventId).toBe("evt_happy");
  });

  test("200 with processed=false on duplicate event.id", async () => {
    const t = initConvexTest();
    await postJson(t, eventBody({ id: "evt_dup" }), {
      Authorization: TEST_SECRET,
    });
    const res = await postJson(t, eventBody({ id: "evt_dup" }), {
      Authorization: TEST_SECRET,
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { processed: boolean; eventId: string };
    expect(json.processed).toBe(false);
    expect(json.eventId).toBe("evt_dup");
  });
});
