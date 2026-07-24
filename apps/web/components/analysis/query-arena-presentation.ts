import type {
  QueryArenaCandidate,
  QueryStrategy,
} from "@/lib/query-arena/contracts";

import type {
  AnalysisPerformanceReport,
  QueryArenaEvidence,
} from "./performance-context";

export type ArenaTrialState = "waiting" | "running" | "complete" | "failed";

export type ArenaTrialModel = {
  readonly index: number;
  readonly state: ArenaTrialState;
  readonly durationMs: number | null;
};

export type ArenaLaneModel = {
  readonly strategy: QueryStrategy;
  readonly label: string;
  readonly state: ArenaTrialState;
  readonly medianMs: number | null;
  readonly trials: readonly ArenaTrialModel[];
  readonly winner: boolean;
  readonly current: boolean;
  readonly verified: boolean | null;
};

export type SystemIntelligence = {
  readonly tracedQuestions: number;
  readonly arenaRuns: number;
  readonly verifiedRaces: number;
  readonly learnedRecipes: number;
  readonly bestSpeedup: number | null;
};

function strategyLabel(strategy: QueryStrategy): string {
  return strategy === "prewhere" ? "Filter early" : "Direct scan";
}

function candidateFor(
  evidence: QueryArenaEvidence,
  strategy: QueryStrategy,
): QueryArenaCandidate | undefined {
  return evidence.candidates.find(
    (candidate) => candidate.strategy === strategy,
  );
}

function exactTrials(candidate: QueryArenaCandidate | undefined) {
  if (candidate === undefined || candidate.status === "failed") {
    return null;
  }

  return candidate.trials.map((trial, index) => ({
    index,
    state: "complete" as const,
    durationMs:
      trial.metrics.serverElapsedMs ?? trial.metrics.roundTripMs,
  }));
}

function liveTrials(
  evidence: QueryArenaEvidence,
  strategy: QueryStrategy,
  state: ArenaTrialState,
): readonly ArenaTrialModel[] {
  const events = evidence.trialEvents.filter(
    (event) => event.strategy === strategy,
  );
  const measured = new Map(
    events.map((event) => [event.trial, event.durationMs]),
  );
  const nextTrial = events.length;

  return Array.from({ length: 3 }, (_, index) => ({
    index,
    state:
      measured.has(index)
        ? ("complete" as const)
        : state === "failed"
          ? ("failed" as const)
          : state === "running" && index === nextTrial
            ? ("running" as const)
            : ("waiting" as const),
    durationMs: measured.get(index) ?? null,
  }));
}

export function buildArenaLanes(
  evidence: QueryArenaEvidence,
): readonly ArenaLaneModel[] {
  return evidence.strategies.map((strategy) => {
    const candidate = candidateFor(evidence, strategy);
    const event = evidence.candidateEvents.find(
      (candidateEvent) => candidateEvent.strategy === strategy,
    );
    const measuredTrials = exactTrials(candidate);
    const failed =
      candidate?.status === "failed" || event?.status === "failed";
    const candidateComplete =
      candidate !== undefined || event?.status === "completed";
    const racing =
      evidence.status === "running" &&
      (evidence.phase === "racing" || evidence.phase === null);
    const state: ArenaTrialState = failed
      ? "failed"
      : candidateComplete
        ? "complete"
        : racing
          ? "running"
          : "waiting";
    const trials =
      measuredTrials ??
      liveTrials(evidence, strategy, state);

    return {
      strategy,
      label: strategyLabel(strategy),
      state,
      medianMs:
        candidate === undefined || candidate.status === "failed"
          ? (event?.medianMs ?? null)
          : (candidate.medianMetrics.serverElapsedMs ??
            candidate.medianMetrics.roundTripMs),
      trials,
      winner: evidence.winner === strategy,
      current: evidence.currentStrategy === strategy,
      verified:
        candidate === undefined
          ? null
          : candidate.status === "verified"
            ? true
            : candidate.status === "mismatch"
              ? false
              : null,
    };
  });
}

export function summarizeSystemIntelligence(
  reports: readonly AnalysisPerformanceReport[],
): SystemIntelligence {
  const evidence = reports.flatMap((report) =>
    report.queryArena === null ? [] : [report.queryArena],
  );
  const speedups = evidence.flatMap((arena) =>
    arena.speedup === null ? [] : [arena.speedup],
  );

  return {
    tracedQuestions: reports.length,
    arenaRuns: evidence.length,
    verifiedRaces: evidence.filter((arena) => arena.verified === true).length,
    learnedRecipes: evidence.filter((arena) => arena.recipeStored === true)
      .length,
    bestSpeedup: speedups.length === 0 ? null : Math.max(...speedups),
  };
}
