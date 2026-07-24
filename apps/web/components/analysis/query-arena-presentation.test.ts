import { describe, expect, it } from "vitest";

import type {
  AnalysisPerformanceReport,
  QueryArenaEvidence,
} from "./performance-context";
import {
  buildArenaLanes,
  summarizeSystemIntelligence,
} from "./query-arena-presentation";

const evidence: QueryArenaEvidence = {
  analysis: {
    kind: "time_series",
    request: {
      shape: "time_series",
      dataset: "uk_price_paid",
      datasetVersion: 1,
      operation: "comparison",
      metric: "average_price",
      interval: "year",
      seriesBy: "town",
      transform: "value",
      anomalyThreshold: null,
      filters: {
        dateFrom: "2015-01-01",
        dateTo: "2023-12-31",
        location: {
          level: "town",
          values: ["Manchester", "Liverpool"],
        },
        propertyTypes: [],
        newBuild: null,
        tenure: [],
        minimumPrice: null,
        maximumPrice: null,
      },
    },
  },
  runId: "run_1",
  status: "completed",
  phase: "completed",
  progress: 1,
  currentStrategy: "baseline",
  winner: "prewhere",
  speedup: 2,
  verified: true,
  historyStored: true,
  recipeStored: true,
  strategies: ["baseline", "prewhere"],
  learningSource: "none",
  priorStrategy: null,
  priorEvidenceCount: 0,
  trialEvents: [],
  candidateEvents: [
    { strategy: "baseline", status: "completed", medianMs: 200 },
    { strategy: "prewhere", status: "completed", medianMs: 100 },
  ],
  candidates: [
    {
      status: "verified",
      strategy: "baseline",
      trials: [180, 200, 220].map((roundTripMs, index) => ({
        metrics: {
          queryId: `baseline_${index}`,
          roundTripMs,
          serverElapsedMs: null,
          rowsRead: 10,
          bytesRead: 20,
          arrowBytes: 30,
        },
        fingerprint: {
          algorithm: "sha256-v1",
          digest: "a".repeat(64),
          rowCount: 1,
        },
      })),
      medianMetrics: {
        queryId: "baseline_1",
        roundTripMs: 200,
        serverElapsedMs: null,
        rowsRead: 10,
        bytesRead: 20,
        arrowBytes: 30,
      },
      fingerprint: {
        algorithm: "sha256-v1",
        digest: "a".repeat(64),
        rowCount: 1,
      },
    },
    {
      status: "verified",
      strategy: "prewhere",
      trials: [90, 100, 110].map((roundTripMs, index) => ({
        metrics: {
          queryId: `prewhere_${index}`,
          roundTripMs,
          serverElapsedMs: null,
          rowsRead: 10,
          bytesRead: 20,
          arrowBytes: 30,
        },
        fingerprint: {
          algorithm: "sha256-v1",
          digest: "a".repeat(64),
          rowCount: 1,
        },
      })),
      medianMetrics: {
        queryId: "prewhere_1",
        roundTripMs: 100,
        serverElapsedMs: null,
        rowsRead: 10,
        bytesRead: 20,
        arrowBytes: 30,
      },
      fingerprint: {
        algorithm: "sha256-v1",
        digest: "a".repeat(64),
        rowCount: 1,
      },
    },
  ],
  error: null,
};

function report(
  id: string,
  queryArena: QueryArenaEvidence | null,
): AnalysisPerformanceReport {
  return {
    id,
    title: "Question",
    question: "Question",
    dataset: "example",
    datasetVersion: 1,
    kind: "trend",
    queryId: id,
    contract: "time_series/v1",
    arrowBytes: 100,
    typedRows: 10,
    roundTripMs: 100,
    wasmStartupMs: 0,
    rustDecodeMs: 1,
    rustComputeMs: 1,
    triggerSessionId: "session",
    triggerMs: 20,
    totalMs: 130,
    completedAt: "2026-07-23T12:00:00.000Z",
    status: "completed",
    failedStage: null,
    errorMessage: null,
    triggerRun: null,
    queryArena,
  };
}

describe("Query Arena presentation", () => {
  it("shows all exact trial timings and marks the verified winner", () => {
    const lanes = buildArenaLanes(evidence);

    expect(lanes).toHaveLength(2);
    expect(lanes[0]?.trials.map((trial) => trial.durationMs)).toEqual([
      180, 200, 220,
    ]);
    expect(lanes[1]).toMatchObject({
      label: "Filter early",
      winner: true,
      verified: true,
      medianMs: 100,
    });
  });

  it("uses only measured session evidence for intelligence totals", () => {
    const summary = summarizeSystemIntelligence([
      report("one", evidence),
      report("two", { ...evidence, recipeStored: false, speedup: 1.5 }),
      report("three", null),
    ]);

    expect(summary).toEqual({
      tracedQuestions: 3,
      arenaRuns: 2,
      verifiedRaces: 2,
      learnedRecipes: 1,
      bestSpeedup: 2,
    });
  });
});
