import { errAsync, okAsync, ResultAsync } from "neverthrow";
import { z } from "zod";

import { getClickHouseClient } from "../../clickhouse/client";

import type { TuningEvidence } from "./contracts";

const evidenceRowsSchema = z.array(
  z.object({
    observed_arenas: z.coerce.number().int().nonnegative(),
    verified_trials: z.coerce.number().int().nonnegative(),
    p95_server_elapsed_ms: z.coerce.number().nonnegative().nullable(),
    median_rows_read: z.coerce.number().int().nonnegative().nullable(),
    first_observed_at: z.string().nullable(),
    last_observed_at: z.string().nullable(),
  }),
);

export type TuningEvidenceError = {
  readonly type: "tuning_evidence_error";
  readonly message: string;
  readonly cause: unknown;
};

function evidenceError(cause: unknown): TuningEvidenceError {
  return {
    type: "tuning_evidence_error",
    message:
      cause instanceof Error
        ? cause.message
        : "Query Arena evidence could not be loaded",
    cause,
  };
}

export function loadTuningEvidence(
  identity: {
    readonly executionSignature: string;
    readonly semanticFamilyHash: string;
    readonly dataset: string;
    readonly datasetVersion: number;
  },
): ResultAsync<TuningEvidence, TuningEvidenceError> {
  return ResultAsync.fromPromise(
    getClickHouseClient().query({
      query: `
        SELECT
          count() AS observed_arenas,
          sum(arena_verified_trials) AS verified_trials,
          quantileExactIfOrNull(0.95)(
            arena_server_elapsed_ms,
            arena_server_elapsed_ms IS NOT NULL
          )
            AS p95_server_elapsed_ms,
          quantileExactIfOrNull(0.5)(
            arena_rows_read,
            arena_rows_read IS NOT NULL
          )
            AS median_rows_read,
          toString(minOrNull(first_observed_at)) AS first_observed_at,
          toString(maxOrNull(last_observed_at)) AS last_observed_at
        FROM
        (
          SELECT
            arena_id,
            count() AS arena_verified_trials,
            quantileExact(0.5)(server_elapsed_ms)
              AS arena_server_elapsed_ms,
            quantileExactIfOrNull(0.5)(
              rows_read,
              rows_read IS NOT NULL
            ) AS arena_rows_read,
            min(recorded_at) AS first_observed_at,
            max(recorded_at) AS last_observed_at
          FROM query_arena_performance_history
          WHERE analysis_signature = {analysisSignature:FixedString(64)}
            AND dataset = {dataset:String}
            AND dataset_version = {datasetVersion:UInt32}
            AND outcome = 'verified'
            AND winner = 1
            AND server_elapsed_ms IS NOT NULL
          GROUP BY arena_id
        )
      `,
      query_params: {
        analysisSignature: identity.executionSignature,
        dataset: identity.dataset,
        datasetVersion: identity.datasetVersion,
      },
      format: "JSONEachRow",
    }),
    evidenceError,
  ).andThen((response) =>
    ResultAsync.fromPromise(response.json(), evidenceError),
  ).andThen((rows) => {
    const parsed = evidenceRowsSchema.safeParse(rows);

    if (!parsed.success || parsed.data[0] === undefined) {
      return errAsync(evidenceError(parsed.error));
    }

    const row = parsed.data[0];
    const iso = (value: string | null) =>
      value === null || value === "" ? null : new Date(value).toISOString();

    return okAsync({
      analysisSignature: identity.executionSignature,
      semanticFamilyHash: identity.semanticFamilyHash,
      observedArenas: row.observed_arenas,
      verifiedTrials: row.verified_trials,
      p95ServerElapsedMs: row.p95_server_elapsed_ms,
      medianRowsRead: row.median_rows_read,
      firstObservedAt: iso(row.first_observed_at),
      lastObservedAt: iso(row.last_observed_at),
    });
  });
}
