"use client";

import { useEffect } from "react";

import {
  useAnalysisPerformance,
} from "@/components/analysis/performance-context";
import type {
  QueryArenaRequest,
  QueryStrategy,
} from "@/lib/query-arena/contracts";
import { useQueryArena } from "@/lib/query-arena/use-query-arena";

export function QueryArenaReporter({
  analysis,
  currentStrategy,
  queryId,
}: {
  readonly analysis: QueryArenaRequest;
  readonly currentStrategy: QueryStrategy;
  readonly queryId: string;
}) {
  const { updateQueryArena } = useAnalysisPerformance();
  const arena = useQueryArena(analysis, queryId);
  const metadata = arena.snapshot?.metadata ?? null;
  const result = arena.snapshot?.result ?? null;
  const status =
    arena.snapshot?.status ??
    (arena.error === null
      ? arena.isStarting
        ? "queued"
        : "running"
      : "failed");

  useEffect(() => {
    updateQueryArena(queryId, {
      analysis,
      runId: arena.runId,
      status,
      phase: metadata?.phase ?? null,
      progress: metadata?.progress ?? (status === "completed" ? 1 : 0),
      currentStrategy,
      winner: result?.winner ?? null,
      speedup: result?.speedup ?? null,
      verified: result?.verified ?? null,
      historyStored: result?.historyStored ?? null,
      recipeStored: result?.recipeStored ?? null,
      strategies: metadata?.strategies ?? ["baseline", "prewhere"],
      learningSource:
        arena.learningSource ??
        result?.learningSource ??
        metadata?.learningSource ??
        "none",
      priorStrategy:
        arena.priorStrategy ??
        result?.priorStrategy ??
        metadata?.priorStrategy ??
        null,
      priorEvidenceCount:
        arena.priorEvidenceCount ||
        result?.priorEvidenceCount ||
        metadata?.priorEvidenceCount ||
        0,
      trialEvents: metadata?.trialEvents ?? [],
      candidateEvents: metadata?.candidateEvents ?? [],
      candidates: result?.candidates ?? [],
      error: arena.snapshot?.error ?? arena.error?.message ?? null,
    });
  }, [
    arena.error,
    arena.runId,
    arena.learningSource,
    arena.priorEvidenceCount,
    arena.priorStrategy,
    arena.snapshot?.error,
    analysis,
    currentStrategy,
    metadata?.phase,
    metadata?.progress,
    metadata?.candidateEvents,
    metadata?.learningSource,
    metadata?.priorEvidenceCount,
    metadata?.priorStrategy,
    metadata?.strategies,
    metadata?.trialEvents,
    queryId,
    result?.candidates,
    result?.historyStored,
    result?.learningSource,
    result?.priorEvidenceCount,
    result?.priorStrategy,
    result?.recipeStored,
    result?.speedup,
    result?.verified,
    result?.winner,
    status,
    updateQueryArena,
  ]);

  return null;
}
