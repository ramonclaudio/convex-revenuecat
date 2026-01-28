/// <reference types="vite/client" />

import { describe, expect, test } from "vitest";
import { internal } from "./_generated/api.js";
import { initConvexTest } from "./setup.test.js";

describe("cleanup", () => {
  describe("rateLimits", () => {
    test("should delete rate limit entries older than 1 minute", async () => {
      const t = initConvexTest();

      const now = Date.now();
      const oldTimestamp = now - 120000;
      const recentTimestamp = now - 30000;

      await t.run(async (ctx) => {
        await ctx.db.insert("rateLimits", { key: "old1", timestamp: oldTimestamp });
        await ctx.db.insert("rateLimits", { key: "old2", timestamp: oldTimestamp - 60000 });
      });

      await t.run(async (ctx) => {
        await ctx.db.insert("rateLimits", { key: "recent1", timestamp: recentTimestamp });
        await ctx.db.insert("rateLimits", { key: "recent2", timestamp: now });
      });

      const deleted = await t.mutation(internal.cleanup.rateLimits, {});
      expect(deleted).toBe(2);

      const remaining = await t.run(async (ctx) => {
        return await ctx.db.query("rateLimits").collect();
      });

      expect(remaining).toHaveLength(2);
      expect(remaining.map((r) => r.key).sort()).toEqual(["recent1", "recent2"]);
    });

    test("should return 0 when no old entries exist", async () => {
      const t = initConvexTest();

      const now = Date.now();

      await t.run(async (ctx) => {
        await ctx.db.insert("rateLimits", { key: "recent", timestamp: now });
      });

      const deleted = await t.mutation(internal.cleanup.rateLimits, {});
      expect(deleted).toBe(0);

      const remaining = await t.run(async (ctx) => {
        return await ctx.db.query("rateLimits").collect();
      });

      expect(remaining).toHaveLength(1);
    });

    test("should handle empty table", async () => {
      const t = initConvexTest();

      const deleted = await t.mutation(internal.cleanup.rateLimits, {});
      expect(deleted).toBe(0);
    });
  });

  describe("webhookEvents", () => {
    test("should delete events older than 30 days", async () => {
      const t = initConvexTest();

      const now = Date.now();
      const thirtyOneDaysAgo = now - 31 * 24 * 60 * 60 * 1000;
      const twentyNineDaysAgo = now - 29 * 24 * 60 * 60 * 1000;

      await t.run(async (ctx) => {
        await ctx.db.insert("webhookEvents", {
          eventId: "old_evt",
          eventType: "TEST",
          environment: "SANDBOX",
          payload: {},
          processedAt: thirtyOneDaysAgo,
          status: "processed",
        });
      });

      await t.run(async (ctx) => {
        await ctx.db.insert("webhookEvents", {
          eventId: "recent_evt",
          eventType: "TEST",
          environment: "SANDBOX",
          payload: {},
          processedAt: twentyNineDaysAgo,
          status: "processed",
        });
      });

      const deleted = await t.mutation(internal.cleanup.webhookEvents, {});
      expect(deleted).toBe(1);

      const remaining = await t.run(async (ctx) => {
        return await ctx.db.query("webhookEvents").collect();
      });

      expect(remaining).toHaveLength(1);
      expect(remaining[0].eventId).toBe("recent_evt");
    });

    test("should handle empty table", async () => {
      const t = initConvexTest();

      const deleted = await t.mutation(internal.cleanup.webhookEvents, {});
      expect(deleted).toBe(0);
    });
  });
});
