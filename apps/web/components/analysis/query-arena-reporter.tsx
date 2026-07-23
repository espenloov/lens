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
  const arena = useQueryArena(analysis);
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
      error: arena.snapshot?.error ?? arena.error?.message ?? null,
    });
  }, [
    arena.error,
    arena.runId,
    arena.snapshot?.error,
    currentStrategy,
    metadata?.phase,
    metadata?.progress,
    queryId,
    result?.historyStored,
    result?.recipeStored,
    result?.speedup,
    result?.verified,
    result?.winner,
    status,
    updateQueryArena,
  ]);

  return null;
}
