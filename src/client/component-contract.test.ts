import { expect, test } from "vitest";
import { RevenueCat } from "./index.js";
import type { ComponentApi } from "../component/_generated/component.js";

// A deployed consumer's `components.revenuecat` resolves to
// `ComponentApi<"revenuecat">`. It must satisfy the `RevenueCat` constructor so
// the documented `new RevenueCat(components.revenuecat, ...)` call typechecks.
// The example app only exercises this via its committed precise generated
// types; this locks the contract directly, so drift between the generated
// component API and the client constructor fails CI. (The pre-`convex dev`
// `AnyComponents` stub is a separate, expected Convex limitation.)
type Expect<T extends true> = T;
type ComponentApiSatisfiesCtor = Expect<
  ComponentApi<"revenuecat"> extends ConstructorParameters<typeof RevenueCat>[0]
    ? true
    : false
>;

test("generated ComponentApi satisfies the RevenueCat constructor", () => {
  const enforced: ComponentApiSatisfiesCtor = true;
  expect(enforced).toBe(true);
});
