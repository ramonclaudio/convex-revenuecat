import { expect, test } from "vitest";
import { RevenueCat } from "./index.js";
import type { FunctionReference } from "convex/server";
import type { ComponentApi } from "../component/_generated/component.js";

type Expect<T extends true> = T;

// 1. A deployed consumer's `components.revenuecat` resolves to
//    `ComponentApi<"revenuecat">`, which must satisfy the `RevenueCat`
//    constructor so the documented `new RevenueCat(components.revenuecat, ...)`
//    call typechecks.
type CtorAcceptsComponentApi = Expect<
  ComponentApi<"revenuecat"> extends ConstructorParameters<typeof RevenueCat>[0]
    ? true
    : false
>;

// 2. Convex codegen stamps every component function "internal". This file is
//    hand-maintained, so lock that invariant: a hand-edit re-introducing
//    "public" (which `npx convex dev` would revert, a silent breaking type
//    change for consumers) fails this typecheck.
type IsInternal<T> = T extends FunctionReference<any, "internal", any, any, any>
  ? true
  : false;
type Api = ComponentApi<"revenuecat">;
type AllTrue<_T extends readonly true[]> = true;
type AllInternal = AllTrue<
  [
    IsInternal<Api["customers"]["get"]>,
    IsInternal<Api["customers"]["purge"]>,
    IsInternal<Api["entitlements"]["list"]>,
    IsInternal<Api["sync"]["ingest"]>,
    IsInternal<Api["experiments"]["list"]>,
    IsInternal<Api["webhookEvents"]["listFailed"]>,
    IsInternal<Api["transfers"]["list"]>,
    IsInternal<Api["transfers"]["backfillTransferParticipants"]>,
    IsInternal<Api["invoices"]["get"]>,
    IsInternal<Api["webhooks"]["process"]>,
    // cleanup.* must stay reachable: consumers schedule it from crons.
    IsInternal<Api["cleanup"]["rateLimits"]>,
    IsInternal<Api["cleanup"]["webhookEvents"]>,
  ]
>;

test("ComponentApi: ctor contract + all-internal invariant hold", () => {
  const ctor: CtorAcceptsComponentApi = true;
  const internal: AllInternal = true;
  expect(ctor && internal).toBe(true);
});
