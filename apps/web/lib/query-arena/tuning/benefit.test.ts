import { describe, expect, it } from "vitest";

import type { TuningEvidence } from "./contracts";
import { validateTuningBenefit } from "./benefit";
import { estimateProjectionImpact } from "./estimate";

const evidence: TuningEvidence = {
  analysisSignature: "a".repeat(64),
  semanticFamilyHash: "b".repeat(64),
  observedArenas: 4,
  verifiedTrials: 24,
  p95ServerElapsedMs: 1_900,
  medianRowsRead: 20_000_000,
  firstObservedAt: "2026-07-23T08:00:00.000Z",
  lastObservedAt: "2026-07-23T09:00:00.000Z",
};

describe("physical tuning benefit gate", () => {
  it("accepts repeated, verified, expensive analysis shapes", () => {
    expect(validateTuningBenefit(evidence).isOk()).toBe(true);
  });

  it("does not propose storage changes from one conversation", () => {
    const result = validateTuningBenefit({
      ...evidence,
      observedArenas: 1,
    });

    expect(result.isErr()).toBe(true);
  });

  it("does not tune analysis shapes that are already fast", () => {
    const result = validateTuningBenefit({
      ...evidence,
      p95ServerElapsedMs: 42,
    });

    expect(result.isErr()).toBe(true);
  });

  it("labels pre-race impact as a low-confidence estimate", () => {
    const estimate = estimateProjectionImpact(evidence, {
      valid: true,
      sourceExists: true,
      mergeTreeFamily: true,
      columnsExist: true,
      projectionExists: false,
      checkedColumns: ["date", "town"],
      engine: "MergeTree",
      sourceBytes: 1_000_000_000,
      messages: ["Ready"],
    });

    expect(estimate).toEqual({
      method: "ordered_projection_heuristic_v1",
      estimatedStorageBytes: {
        lower: 700_000_000,
        upper: 1_300_000_000,
      },
      predictedSpeedup: {
        lower: 1.5,
        upper: 10,
      },
      confidence: "low_until_reraced",
    });
  });
});
