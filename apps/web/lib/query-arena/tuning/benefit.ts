import { err, ok, type Result } from "neverthrow";

import type { TuningEvidence } from "./contracts";

export type TuningBenefitError = {
  readonly type: "tuning_benefit_error";
  readonly message: string;
};

export const MINIMUM_OBSERVED_ARENAS = 3;
export const MINIMUM_P95_SERVER_MS = 100;

export function validateTuningBenefit(
  evidence: TuningEvidence,
): Result<TuningEvidence, TuningBenefitError> {
  if (evidence.observedArenas < MINIMUM_OBSERVED_ARENAS) {
    return err({
      type: "tuning_benefit_error",
      message: `Lens needs at least ${MINIMUM_OBSERVED_ARENAS} repeated Arena runs before proposing physical storage`,
    });
  }

  if (evidence.verifiedTrials === 0) {
    return err({
      type: "tuning_benefit_error",
      message: "No Rust-verified Arena trials support this proposal",
    });
  }

  if (
    evidence.p95ServerElapsedMs === null ||
    evidence.p95ServerElapsedMs < MINIMUM_P95_SERVER_MS
  ) {
    return err({
      type: "tuning_benefit_error",
      message: `The measured p95 is already below ${MINIMUM_P95_SERVER_MS} ms`,
    });
  }

  return ok(evidence);
}

