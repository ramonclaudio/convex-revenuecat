import { v } from "convex/values";
import { action } from "./_generated/server.js";

// RevenueCat API v2 - for read operations (customers, subscriptions, etc.)
const REVENUECAT_API_V2 = "https://api.revenuecat.com/v2";

// RevenueCat API v1 - for promotional entitlement operations
const REVENUECAT_API_V1 = "https://api.revenuecat.com/v1";

const durationValidator = v.union(
  v.literal("daily"),
  v.literal("three_day"),
  v.literal("weekly"),
  v.literal("monthly"),
  v.literal("two_month"),
  v.literal("three_month"),
  v.literal("six_month"),
  v.literal("yearly"),
  v.literal("lifetime"),
);

/**
 * Get customer info from RevenueCat API (v2)
 * Requires: v2 API key and projectId
 */
export const getCustomer = action({
  args: {
    apiKey: v.string(),
    projectId: v.string(),
    appUserId: v.string(),
  },
  returns: v.any(),
  handler: async (_ctx, args) => {
    const { apiKey, projectId, appUserId } = args;

    const response = await fetch(
      `${REVENUECAT_API_V2}/projects/${projectId}/customers/${encodeURIComponent(appUserId)}`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
      },
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`RevenueCat API v2 error: ${response.status} - ${error}`);
    }

    return await response.json();
  },
});

/**
 * Grant a promotional entitlement to a customer via RevenueCat API (v1)
 *
 * Note: RevenueCat API v2 does not support promotional entitlements.
 * This uses the v1 API endpoint.
 *
 * @see https://www.revenuecat.com/docs/api-v1#tag/entitlements/operation/grant-a-promotional-entitlement
 */
export const grantEntitlement = action({
  args: {
    apiKey: v.string(),
    appUserId: v.string(),
    entitlementId: v.string(),
    duration: durationValidator,
  },
  returns: v.any(),
  handler: async (_ctx, args) => {
    const { apiKey, appUserId, entitlementId, duration } = args;

    const response = await fetch(
      `${REVENUECAT_API_V1}/subscribers/${encodeURIComponent(appUserId)}/entitlements/${encodeURIComponent(entitlementId)}/promotional`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ duration }),
      },
    );

    if (!response.ok) {
      const error = await response.text();
      if (response.status === 403) {
        throw new Error(
          `RevenueCat API v1 auth error: ${error}. ` +
            "Make sure you're using a v1 API key (NOT sk_* format).",
        );
      }
      throw new Error(`RevenueCat API v1 error: ${response.status} - ${error}`);
    }

    return await response.json();
  },
});

/**
 * Revoke a promotional entitlement from a customer via RevenueCat API (v1)
 *
 * Note: RevenueCat API v2 does not support promotional entitlements.
 * This uses the v1 API endpoint.
 *
 * @see https://www.revenuecat.com/docs/api-v1#tag/entitlements/operation/revoke-promotional-entitlements
 */
export const revokeEntitlement = action({
  args: {
    apiKey: v.string(),
    appUserId: v.string(),
    entitlementId: v.string(),
  },
  returns: v.any(),
  handler: async (_ctx, args) => {
    const { apiKey, appUserId, entitlementId } = args;

    // Note: v1 uses POST to /revoke_promotionals (not DELETE to /promotional)
    const response = await fetch(
      `${REVENUECAT_API_V1}/subscribers/${encodeURIComponent(appUserId)}/entitlements/${encodeURIComponent(entitlementId)}/revoke_promotionals`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
      },
    );

    if (!response.ok) {
      const error = await response.text();
      if (response.status === 403) {
        throw new Error(
          `RevenueCat API v1 auth error: ${error}. ` +
            "Make sure you're using a v1 API key (NOT sk_* format).",
        );
      }
      throw new Error(`RevenueCat API v1 error: ${response.status} - ${error}`);
    }

    return await response.json();
  },
});

/**
 * Delete a customer from RevenueCat (v1)
 * Use for GDPR compliance / right to deletion requests.
 *
 * WARNING: This permanently deletes the customer and all their data.
 * This action cannot be undone.
 *
 * @see https://www.revenuecat.com/docs/api-v1#tag/customers/operation/delete-subscriber
 */
export const deleteCustomer = action({
  args: {
    apiKey: v.string(),
    appUserId: v.string(),
  },
  returns: v.object({
    deleted: v.boolean(),
    app_user_id: v.string(),
  }),
  handler: async (_ctx, args) => {
    const { apiKey, appUserId } = args;

    const response = await fetch(
      `${REVENUECAT_API_V1}/subscribers/${encodeURIComponent(appUserId)}`,
      {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
      },
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`RevenueCat API error: ${response.status} - ${error}`);
    }

    return { deleted: true, app_user_id: appUserId };
  },
});

/**
 * Update customer attributes via RevenueCat API (v1)
 * Set or update custom attributes on a customer from your backend.
 *
 * Attribute keys starting with $ are reserved (e.g., $email, $displayName).
 * Custom attribute keys must not start with $.
 *
 * @see https://www.revenuecat.com/docs/api-v1#tag/customers/operation/update-subscriber-attributes
 */
export const updateAttributes = action({
  args: {
    apiKey: v.string(),
    appUserId: v.string(),
    attributes: v.record(
      v.string(),
      v.object({
        value: v.union(v.string(), v.null()),
        updated_at_ms: v.optional(v.number()),
      }),
    ),
  },
  returns: v.any(),
  handler: async (_ctx, args) => {
    const { apiKey, appUserId, attributes } = args;

    const response = await fetch(
      `${REVENUECAT_API_V1}/subscribers/${encodeURIComponent(appUserId)}/attributes`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ attributes }),
      },
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`RevenueCat API error: ${response.status} - ${error}`);
    }

    // API returns empty response on success
    return { success: true };
  },
});

/**
 * Get offerings for a customer via RevenueCat API (v1)
 * Useful for server-rendered paywalls or backend offering logic.
 *
 * Returns the current offering and all available offerings for the customer.
 *
 * @see https://www.revenuecat.com/docs/api-v1#tag/offerings/operation/get-offerings
 */
export const getOfferings = action({
  args: {
    apiKey: v.string(),
    appUserId: v.string(),
    platform: v.optional(
      v.union(
        v.literal("ios"),
        v.literal("android"),
        v.literal("amazon"),
        v.literal("macos"),
        v.literal("uikitformac"),
      ),
    ),
  },
  returns: v.any(),
  handler: async (_ctx, args) => {
    const { apiKey, appUserId, platform } = args;

    const url = new URL(
      `${REVENUECAT_API_V1}/subscribers/${encodeURIComponent(appUserId)}/offerings`,
    );

    const headers: Record<string, string> = {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    };

    // Platform header is required to get platform-specific products
    if (platform) {
      headers["X-Platform"] = platform;
    }

    const response = await fetch(url.toString(), {
      method: "GET",
      headers,
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`RevenueCat API error: ${response.status} - ${error}`);
    }

    return await response.json();
  },
});
