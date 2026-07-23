import { z } from "zod";

import { semanticAnalysisRequestSchema } from "../analysis/semantic-plan";
import { queryArenaTimeSeriesRequestSchema } from "../time-series/contracts";

export const queryStrategySchema = z.enum(["baseline", "prewhere"]);

export const queryFingerprintSchema = z.object({
  algorithm: z.literal("sha256-v1"),
  digest: z.string().regex(/^[a-f0-9]{64}$/),
  rowCount: z.number().int().nonnegative(),
});

export const queryBenchmarkMetricsSchema = z.object({
  queryId: z.string().min(1),
  roundTripMs: z.number().nonnegative(),
  serverElapsedMs: z.number().nonnegative().nullable(),
  rowsRead: z.number().int().nonnegative().nullable(),
  bytesRead: z.number().int().nonnegative().nullable(),
  arrowBytes: z.number().int().nonnegative(),
});

export const queryBenchmarkTrialSchema = z.object({
  metrics: queryBenchmarkMetricsSchema,
  fingerprint: queryFingerprintSchema,
});

export const strategyBenchmarkSchema = z.object({
  strategy: queryStrategySchema,
  trials: z.array(queryBenchmarkTrialSchema).length(3),
  medianMetrics: queryBenchmarkMetricsSchema,
  fingerprint: queryFingerprintSchema,
});

export const queryArenaCandidateSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("verified"),
    strategy: queryStrategySchema,
    trials: z.array(queryBenchmarkTrialSchema).length(3),
    medianMetrics: queryBenchmarkMetricsSchema,
    fingerprint: queryFingerprintSchema,
  }),
  z.object({
    status: z.literal("mismatch"),
    strategy: queryStrategySchema,
    trials: z.array(queryBenchmarkTrialSchema).length(3),
    medianMetrics: queryBenchmarkMetricsSchema,
    fingerprint: queryFingerprintSchema,
  }),
  z.object({
    status: z.literal("failed"),
    strategy: queryStrategySchema,
    message: z.string().min(1),
  }),
]);

export const queryArenaResultSchema = z.object({
  arenaId: z.uuid(),
  signature: z.string().regex(/^[a-f0-9]{64}$/),
  baselineStrategy: queryStrategySchema,
  candidates: z.array(queryArenaCandidateSchema).min(2),
  winner: queryStrategySchema.nullable(),
  verified: z.boolean(),
  speedup: z.number().positive().nullable(),
  historyStored: z.boolean(),
  recipeStored: z.boolean(),
  completedAt: z.iso.datetime(),
});

export const queryArenaPhaseSchema = z.enum([
  "queued",
  "racing",
  "verifying",
  "persisting",
  "completed",
  "failed",
]);

export const queryArenaMetadataSchema = z.object({
  phase: queryArenaPhaseSchema,
  progress: z.number().min(0).max(1),
  strategies: z.array(queryStrategySchema),
  completedCandidates: z.number().int().min(0).max(2).optional(),
  candidateEvents: z
    .array(
      z.object({
        strategy: queryStrategySchema,
        status: z.enum(["completed", "failed"]),
        medianMs: z.number().nonnegative().nullable(),
      }),
    )
    .optional(),
});

export const queryArenaSemanticRequestSchema =
  semanticAnalysisRequestSchema.refine(
    (request) => {
      if (request.shape !== "time_series") {
        return false;
      }

      const plan = request.plan;

      if (
        plan.operation === "distribution" ||
        plan.operation === "ranking"
      ) {
        return false;
      }

      if (
        plan.operation === "comparison" ||
        plan.operation === "trend" ||
        plan.operation === "anomaly"
      ) {
        return (
          plan.metric.kind === "row_count" ||
          plan.metric.aggregation !== "median"
        );
      }

      return true;
    },
    {
      message:
        "Query Arena supports exact manifest-driven time-series analyses",
    },
  );

export const queryArenaRequestSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("time_series"),
    request: queryArenaTimeSeriesRequestSchema,
  }),
  z.object({
    kind: z.literal("semantic"),
    request: queryArenaSemanticRequestSchema,
  }),
]);

export const queryArenaStartSchema = z.object({
  analysis: queryArenaRequestSchema,
});

export const queryArenaStartResponseSchema = z.object({
  runId: z.string().min(1),
  arenaId: z.uuid(),
  signature: z.string().regex(/^[a-f0-9]{64}$/),
});

export const queryArenaSnapshotSchema = z.object({
  status: z.enum(["queued", "running", "completed", "failed"]),
  metadata: queryArenaMetadataSchema.nullable(),
  result: queryArenaResultSchema.nullable(),
  error: z.string().nullable(),
});

export type QueryStrategy = z.infer<typeof queryStrategySchema>;
export type QueryFingerprint = z.infer<typeof queryFingerprintSchema>;
export type QueryBenchmarkMetrics = z.infer<
  typeof queryBenchmarkMetricsSchema
>;
export type QueryBenchmarkTrial = z.infer<typeof queryBenchmarkTrialSchema>;
export type StrategyBenchmark = z.infer<typeof strategyBenchmarkSchema>;
export type QueryArenaCandidate = z.infer<typeof queryArenaCandidateSchema>;
export type QueryArenaResult = z.infer<typeof queryArenaResultSchema>;
export type QueryArenaMetadata = z.infer<typeof queryArenaMetadataSchema>;
export type QueryArenaSnapshot = z.infer<typeof queryArenaSnapshotSchema>;
export type QueryArenaRequest = z.infer<typeof queryArenaRequestSchema>;
