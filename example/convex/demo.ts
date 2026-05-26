// DEMO ONLY. These queries take an explicit `appUserId` so the example UI can
// inspect any user the webhooks populate, without standing up auth. Production
// code must NOT accept `appUserId` from the client, that's an IDOR. Use the
// identity-aware `revenuecat.api()` in `subscriptions.ts` (see the README
// "Authorize every query"). This file exists purely to drive the showcase UI.
import { v } from "convex/values";
import { query } from "./_generated/server.js";
import { components } from "./_generated/api.js";
import { RevenueCat } from "convex-revenuecat";

const revenuecat = new RevenueCat(components.revenuecat, {
  REVENUECAT_WEBHOOK_AUTH: process.env.REVENUECAT_WEBHOOK_AUTH,
});

/** Everything the showcase panels render, in one reactive read. */
export const status = query({
  args: { appUserId: v.string() },
  handler: async (ctx, { appUserId }) => {
    const [
      isSubscriber,
      isInTrial,
      customer,
      activeEntitlements,
      subscriptions,
      gracePeriod,
      virtualCurrency,
      invoices,
    ] = await Promise.all([
      revenuecat.isSubscriber(ctx, { appUserId }),
      revenuecat.isInTrial(ctx, { appUserId }),
      revenuecat.getCustomer(ctx, { appUserId }),
      revenuecat.getActiveEntitlements(ctx, { appUserId }),
      revenuecat.getAllSubscriptions(ctx, { appUserId }),
      revenuecat.getSubscriptionsInGracePeriod(ctx, { appUserId }),
      revenuecat.getVirtualCurrencyBalances(ctx, { appUserId }),
      revenuecat.getInvoices(ctx, { appUserId }),
    ]);
    return {
      isSubscriber,
      isInTrial,
      customer,
      activeEntitlements,
      subscriptions,
      gracePeriod,
      virtualCurrency,
      invoices,
    };
  },
});

/** Recent webhook events for the user, newest first, so the UI can show events
 * landing live. (TRANSFER events carry no app_user_id and won't appear here.) */
export const recentEvents = query({
  args: { appUserId: v.string() },
  handler: async (ctx, { appUserId }) => {
    return await ctx.runQuery(components.revenuecat.webhookEvents.listByUser, {
      appUserId,
      limit: 25,
    });
  },
});
