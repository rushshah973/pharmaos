// F9 — determinism (implementationplan.md §14.1).
import { describe, expect, it } from "vitest";
import { buildPlan } from "@/lib/business-logic/engine";
import { makeContext } from "@/tests/fixtures/engine";

describe("F9 determinism", () => {
  it("buildPlan twice on the same context gives deep-equal output", () => {
    const ctx = makeContext();
    const first = buildPlan(ctx, "200000.00");
    const second = buildPlan(makeContext(), "200000.00");
    expect(second).toEqual(first);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });
});
