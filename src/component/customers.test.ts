/// <reference types="vite/client" />

import { describe, expect, test } from "vitest";
import { api } from "./_generated/api.js";
import { initConvexTest } from "./setup.test.js";

describe("customers", () => {
  test("get returns null when customer not found", async () => {
    const t = initConvexTest();

    const result = await t.query(api.customers.get, {
      appUserId: "nonexistent",
    });

    expect(result).toBeNull();
  });

  test("upsert creates new customer", async () => {
    const t = initConvexTest();

    const id = await t.mutation(api.customers.upsert, {
      appUserId: "user_123",
      originalAppUserId: "user_123",
      aliases: ["user_123"],
    });

    expect(id).toBeDefined();

    const customer = await t.query(api.customers.get, {
      appUserId: "user_123",
    });

    expect(customer).not.toBeNull();
    expect(customer?.appUserId).toBe("user_123");
    expect(customer?.aliases).toContain("user_123");
  });

  test("upsert updates existing customer and merges aliases", async () => {
    const t = initConvexTest();

    await t.mutation(api.customers.upsert, {
      appUserId: "user_456",
      originalAppUserId: "user_456",
      aliases: ["user_456"],
    });

    // Update with new alias
    await t.mutation(api.customers.upsert, {
      appUserId: "user_456",
      originalAppUserId: "user_456",
      aliases: ["alias_1", "alias_2"],
    });

    const customer = await t.query(api.customers.get, {
      appUserId: "user_456",
    });

    expect(customer?.aliases).toContain("user_456");
    expect(customer?.aliases).toContain("alias_1");
    expect(customer?.aliases).toContain("alias_2");
    expect(customer?.aliases).toHaveLength(3);
  });

  test("getByOriginalId finds customer", async () => {
    const t = initConvexTest();

    await t.mutation(api.customers.upsert, {
      appUserId: "user_789",
      originalAppUserId: "original_789",
      aliases: ["user_789"],
    });

    const customer = await t.query(api.customers.getByOriginalId, {
      originalAppUserId: "original_789",
    });

    expect(customer).not.toBeNull();
    expect(customer?.appUserId).toBe("user_789");
  });

  test("getByOriginalId returns null when not found", async () => {
    const t = initConvexTest();

    const customer = await t.query(api.customers.getByOriginalId, {
      originalAppUserId: "nonexistent",
    });

    expect(customer).toBeNull();
  });

  test("upsert preserves firstSeenAt on update", async () => {
    const t = initConvexTest();

    const firstSeenAt = Date.now() - 1000000;

    await t.mutation(api.customers.upsert, {
      appUserId: "user_preserve",
      originalAppUserId: "user_preserve",
      aliases: [],
      firstSeenAt,
    });

    // Update without firstSeenAt
    await t.mutation(api.customers.upsert, {
      appUserId: "user_preserve",
      originalAppUserId: "user_preserve",
      aliases: ["new_alias"],
    });

    const customer = await t.query(api.customers.get, {
      appUserId: "user_preserve",
    });

    expect(customer?.firstSeenAt).toBe(firstSeenAt);
  });
});
