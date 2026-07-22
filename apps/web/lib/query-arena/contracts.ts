import { z } from "zod";

import { timeSeriesRequestSchema } from "../time-series/contracts";

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

export const queryArenaStartSchema = z.object({
  request: timeSeriesRequestSchema,
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
