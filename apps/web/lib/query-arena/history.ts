import { ResultAsync } from "neverthrow";

import { getClickHouseClient } from "../clickhouse/client";

import type {
  QueryArenaCandidate,
  QueryStrategy,
} from "./contracts";

type PerformanceHistoryRow = {
  readonly arena_id: string;
  readonly analysis_signature: string;
  readonly strategy: QueryStrategy;
  readonly query_id: string | null;
  readonly round_trip_ms: number | null;
  readonly server_elapsed_ms: number | null;
  readonly rows_read: number | null;
  readonly bytes_read: number | null;
  readonly arrow_bytes: number | null;
  readonly fingerprint: string | null;
  readonly row_count: number | null;
  readonly outcome: "verified" | "mismatch" | "failed";
  readonly error_message: string | null;
  readonly winner: boolean;
  readonly recorded_at: string;
};

export type PerformanceHistoryError = {
  readonly type: "performance_history_error";
  readonly message: string;
  readonly cause: unknown;
};

function toHistoryError(cause: unknown): PerformanceHistoryError {
  return {
    type: "performance_history_error",
    message:
      cause instanceof Error
        ? cause.message
        : "ClickHouse could not store Query Arena history",
    cause,
  };
}

export function toPerformanceHistoryRows(input: {
  readonly arenaId: string;
  readonly signature: string;
  readonly candidates: readonly QueryArenaCandidate[];
  readonly winner: QueryStrategy | null;
  readonly recordedAt: string;
}): PerformanceHistoryRow[] {
  return input.candidates.flatMap<PerformanceHistoryRow>((candidate) => {
    if (candidate.status === "failed") {
      return [
        {
          arena_id: input.arenaId,
          analysis_signature: input.signature,
          strategy: candidate.strategy,
          query_id: null,
          round_trip_ms: null,
          server_elapsed_ms: null,
          rows_read: null,
          bytes_read: null,
          arrow_bytes: null,
          fingerprint: null,
          row_count: null,
          outcome: candidate.status,
          error_message: candidate.message,
          winner: false,
          recorded_at: input.recordedAt,
        },
      ];
    }

    return candidate.trials.map((trial) => ({
      arena_id: input.arenaId,
      analysis_signature: input.signature,
      strategy: candidate.strategy,
      query_id: trial.metrics.queryId,
      round_trip_ms: trial.metrics.roundTripMs,
      server_elapsed_ms: trial.metrics.serverElapsedMs,
      rows_read: trial.metrics.rowsRead,
      bytes_read: trial.metrics.bytesRead,
      arrow_bytes: trial.metrics.arrowBytes,
      fingerprint: trial.fingerprint.digest,
      row_count: trial.fingerprint.rowCount,
      outcome: candidate.status,
      error_message: null,
      winner: candidate.strategy === input.winner,
      recorded_at: input.recordedAt,
    }));
  });
}

export function appendPerformanceHistory(
  rows: readonly PerformanceHistoryRow[],
): ResultAsync<boolean, PerformanceHistoryError> {
  if (rows.length === 0) {
    return ResultAsync.fromSafePromise(Promise.resolve(false));
  }

  return ResultAsync.fromPromise(
    getClickHouseClient().insert({
      table: "query_arena_performance_history",
      values: [...rows],
      format: "JSONEachRow",
    }),
    toHistoryError,
  ).map(() => true);
}
