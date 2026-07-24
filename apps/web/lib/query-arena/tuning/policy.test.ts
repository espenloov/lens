import { describe, expect, it } from "vitest";

import { BUILTIN_DATA_SOURCE } from "../../data-sources/builtin";

import {
  evaluateTuningEligibility,
  parseTunableDataSources,
} from "./policy";

describe("physical tuning allowlist", () => {
  it("fails closed when the server allowlist is empty", () => {
    const eligibility = evaluateTuningEligibility(BUILTIN_DATA_SOURCE, {
      allowlist: "",
      executionEnabled: "true",
    });

    expect(eligibility).toMatchObject({
      eligible: false,
      managed: false,
      writable: false,
      executionEnabled: true,
    });
  });

  it("requires the exact immutable source identity", () => {
    const eligibility = evaluateTuningEligibility(BUILTIN_DATA_SOURCE, {
      allowlist: "uk_price_paid@2:default.pp_complete",
      executionEnabled: "true",
    });

    expect(eligibility.eligible).toBe(false);
  });

  it("separates proposal eligibility from physical execution", () => {
    const eligibility = evaluateTuningEligibility(BUILTIN_DATA_SOURCE, {
      allowlist: "uk_price_paid@1:default.pp_complete",
      executionEnabled: "false",
    });

    expect(eligibility).toMatchObject({
      eligible: true,
      managed: true,
      writable: true,
      executionEnabled: false,
    });
  });

  it("rejects the entire allowlist when any entry is malformed", () => {
    expect(
      parseTunableDataSources(
        "uk_price_paid@1:default.pp_complete,default.pp_complete",
      ),
    ).toEqual([]);
  });
});
