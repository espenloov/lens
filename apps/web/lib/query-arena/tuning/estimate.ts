import type {
  TuningEvidence,
  TuningImpactEstimate,
  TuningValidation,
} from "./contracts";

export function estimateProjectionImpact(
  evidence: TuningEvidence,
  validation: TuningValidation,
): TuningImpactEstimate {
  const sourceBytes = validation.sourceBytes;
  const slowP95 =
    evidence.p95ServerElapsedMs !== null &&
    evidence.p95ServerElapsedMs >= 1_000;

  return {
    method: "ordered_projection_heuristic_v1",
    estimatedStorageBytes:
      sourceBytes === null
        ? null
        : {
            lower: Math.floor(sourceBytes * 0.7),
            upper: Math.ceil(sourceBytes * 1.3),
          },
    predictedSpeedup: {
      lower: slowP95 ? 1.5 : 1.2,
      upper: slowP95 ? 10 : 6,
    },
    confidence: "low_until_reraced",
  };
}

