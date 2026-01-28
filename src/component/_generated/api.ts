/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as cleanup from "../cleanup.js";
import type * as customers from "../customers.js";
import type * as entitlements from "../entitlements.js";
import type * as experiments from "../experiments.js";
import type * as handlers from "../handlers.js";
import type * as subscriptions from "../subscriptions.js";
import type * as webhookEvents from "../webhookEvents.js";
import type * as webhooks from "../webhooks.js";

import type { ApiFromModules, FilterApi, FunctionReference } from "convex/server";
import { anyApi, componentsGeneric } from "convex/server";

const fullApi: ApiFromModules<{
  cleanup: typeof cleanup;
  customers: typeof customers;
  entitlements: typeof entitlements;
  experiments: typeof experiments;
  handlers: typeof handlers;
  subscriptions: typeof subscriptions;
  webhookEvents: typeof webhookEvents;
  webhooks: typeof webhooks;
}> = anyApi as any;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export const api: FilterApi<typeof fullApi, FunctionReference<any, "public">> = anyApi as any;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
> = anyApi as any;

export const components = componentsGeneric() as unknown as {};
