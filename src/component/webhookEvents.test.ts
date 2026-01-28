import { describe, expect, it } from "vitest";
import { api } from "./_generated/api.js";
import { initConvexTest } from "./setup.test.js";

describe("webhookEvents", () => {
  it("should get webhook event by event ID", async () => {
    const t = initConvexTest();

    await t.run(async (ctx) => {
      await ctx.db.insert("webhookEvents", {
        eventId: "evt_123",
        eventType: "INITIAL_PURCHASE",
        appUserId: "user_1",
        environment: "PRODUCTION",
        payload: { test: true },
        processedAt: Date.now(),
        status: "processed",
      });
    });

    const event = await t.query(api.webhookEvents.getByEventId, {
      eventId: "evt_123",
    });
    expect(event).not.toBeNull();
    expect(event?.eventType).toBe("INITIAL_PURCHASE");
  });

  it("should return null for non-existent event ID", async () => {
    const t = initConvexTest();

    const event = await t.query(api.webhookEvents.getByEventId, {
      eventId: "non_existent",
    });
    expect(event).toBeNull();
  });

  it("should list webhook events by user", async () => {
    const t = initConvexTest();

    await t.run(async (ctx) => {
      await ctx.db.insert("webhookEvents", {
        eventId: "evt_1",
        eventType: "INITIAL_PURCHASE",
        appUserId: "user_1",
        environment: "PRODUCTION",
        payload: {},
        processedAt: Date.now(),
        status: "processed",
      });
      await ctx.db.insert("webhookEvents", {
        eventId: "evt_2",
        eventType: "RENEWAL",
        appUserId: "user_1",
        environment: "PRODUCTION",
        payload: {},
        processedAt: Date.now() + 1000,
        status: "processed",
      });
      await ctx.db.insert("webhookEvents", {
        eventId: "evt_3",
        eventType: "INITIAL_PURCHASE",
        appUserId: "user_2",
        environment: "PRODUCTION",
        payload: {},
        processedAt: Date.now(),
        status: "processed",
      });
    });

    const events = await t.query(api.webhookEvents.listByUser, {
      appUserId: "user_1",
    });
    expect(events.length).toBe(2);
    expect(events.every((e) => e.appUserId === "user_1")).toBe(true);
  });

  it("should list webhook events by type", async () => {
    const t = initConvexTest();

    await t.run(async (ctx) => {
      await ctx.db.insert("webhookEvents", {
        eventId: "evt_1",
        eventType: "INITIAL_PURCHASE",
        environment: "PRODUCTION",
        payload: {},
        processedAt: Date.now(),
        status: "processed",
      });
      await ctx.db.insert("webhookEvents", {
        eventId: "evt_2",
        eventType: "RENEWAL",
        environment: "PRODUCTION",
        payload: {},
        processedAt: Date.now(),
        status: "processed",
      });
      await ctx.db.insert("webhookEvents", {
        eventId: "evt_3",
        eventType: "INITIAL_PURCHASE",
        environment: "PRODUCTION",
        payload: {},
        processedAt: Date.now(),
        status: "processed",
      });
    });

    const events = await t.query(api.webhookEvents.listByType, {
      eventType: "INITIAL_PURCHASE",
    });
    expect(events.length).toBe(2);
    expect(events.every((e) => e.eventType === "INITIAL_PURCHASE")).toBe(true);
  });

  it("should list failed webhook events", async () => {
    const t = initConvexTest();

    await t.run(async (ctx) => {
      await ctx.db.insert("webhookEvents", {
        eventId: "evt_1",
        eventType: "INITIAL_PURCHASE",
        environment: "PRODUCTION",
        payload: {},
        processedAt: Date.now(),
        status: "processed",
      });
      await ctx.db.insert("webhookEvents", {
        eventId: "evt_2",
        eventType: "RENEWAL",
        environment: "PRODUCTION",
        payload: {},
        processedAt: Date.now(),
        status: "failed",
        error: "Handler error",
      });
      await ctx.db.insert("webhookEvents", {
        eventId: "evt_3",
        eventType: "CANCELLATION",
        environment: "PRODUCTION",
        payload: {},
        processedAt: Date.now(),
        status: "failed",
        error: "Validation error",
      });
      await ctx.db.insert("webhookEvents", {
        eventId: "evt_4",
        eventType: "TEST",
        environment: "PRODUCTION",
        payload: {},
        processedAt: Date.now(),
        status: "ignored",
      });
    });

    const failedEvents = await t.query(api.webhookEvents.listFailed, {});
    expect(failedEvents.length).toBe(2);
    expect(failedEvents.every((e) => e.status === "failed")).toBe(true);
  });

  it("should respect limit parameter", async () => {
    const t = initConvexTest();

    await t.run(async (ctx) => {
      for (let i = 0; i < 10; i++) {
        await ctx.db.insert("webhookEvents", {
          eventId: `evt_${i}`,
          eventType: "INITIAL_PURCHASE",
          appUserId: "user_1",
          environment: "PRODUCTION",
          payload: {},
          processedAt: Date.now() + i,
          status: "processed",
        });
      }
    });

    const events = await t.query(api.webhookEvents.listByUser, {
      appUserId: "user_1",
      limit: 5,
    });
    expect(events.length).toBe(5);
  });
});
