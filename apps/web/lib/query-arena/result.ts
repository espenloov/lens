import {
  queryArenaCandidateSchema,
  type QueryArenaCandidate,
  type QueryStrategy,
  type StrategyBenchmark,
} from "./contracts";

export type StrategyBenchmarkOutcome =
  | {
      readonly ok: true;
      readonly output: StrategyBenchmark;
    }
  | {
      readonly ok: false;
      readonly error: unknown;
    };

export type QueryArenaEvaluation = {
  readonly candidates: QueryArenaCandidate[];
  readonly winnerBenchmark: StrategyBenchmark | null;
  readonly winner: QueryStrategy | null;
  readonly verified: boolean;
  readonly speedup: number | null;
};

export function benchmarkTime(benchmark: StrategyBenchmark): number {
  return (
    benchmark.medianMetrics.serverElapsedMs ??
    benchmark.medianMetrics.roundTripMs
  );
}

function failedCandidate(
  strategy: QueryStrategy,
  error: unknown,
): QueryArenaCandidate {
  return {
    status: "failed",
    strategy,
    message: error instanceof Error ? error.message : "The strategy failed",
  };
}

export function evaluateQueryArena(
  strategies: readonly QueryStrategy[],
  outcomes: readonly StrategyBenchmarkOutcome[],
): QueryArenaEvaluation {
  const successful = outcomes.flatMap((outcome) =>
    outcome.ok ? [outcome.output] : [],
  );
  const baseline = successful.find(
    (candidate) => candidate.strategy === "baseline",
  );
  const referenceFingerprint = baseline?.fingerprint;
  const candidates = outcomes.map((outcome, index) => {
    const strategy = strategies[index] ?? "baseline";

    if (!outcome.ok) {
      return failedCandidate(strategy, outcome.error);
    }

    const matches =
      referenceFingerprint !== undefined &&
      outcome.output.fingerprint.digest === referenceFingerprint.digest &&
      outcome.output.fingerprint.rowCount === referenceFingerprint.rowCount;

    return queryArenaCandidateSchema.parse({
      status: matches ? "verified" : "mismatch",
      ...outcome.output,
    });
  });
  const verified =
    successful.length === strategies.length &&
    candidates.every((candidate) => candidate.status === "verified");
  const winnerBenchmark = verified
    ? [...successful].sort(
        (left, right) => benchmarkTime(left) - benchmarkTime(right),
      )[0]
    : null;
  const winner = winnerBenchmark?.strategy ?? null;
  const speedup =
    baseline !== undefined && winnerBenchmark !== null
      ? benchmarkTime(baseline) / benchmarkTime(winnerBenchmark)
      : null;

  return {
    candidates,
    winnerBenchmark,
    winner,
    verified,
    speedup,
  };
}
