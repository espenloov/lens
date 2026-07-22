import type { Readable } from "node:stream";

import type { ResponseHeaders } from "@clickhouse/client";
import { errAsync, ResultAsync } from "neverthrow";
import { z } from "zod";

import type { ExplorationRequest } from "@/lib/analysis/execution";
import {
  compileAnalysisQuery,
  compileExplorationCountQuery,
} from "@/lib/analysis/query-compiler";

import { getClickHouseClient } from "./client";

const countRowsSchema = z
  .array(
    z.object({
      row_count: z.coerce.number().int().nonnegative(),
    }),
  )
  .length(1);

export type ExplorationArrowResult = {
  readonly stream: Readable;
  readonly queryId: string;
  readonly sourceRows: number;
  readonly responseHeaders: ResponseHeaders;
};

export type ExplorationArrowError =
  | {
      readonly type: "exploration_query_error";
      readonly message: string;
      readonly cause: unknown;
    }
  | {
      readonly type: "exploration_too_large";
      readonly message: string;
      readonly sourceRows: number;
      readonly rowLimit: number;
    }
  | {
      readonly type: "exploration_busy";
      readonly message: string;
    };

let activeExplorations = 0;

function queryError(cause: unknown): ExplorationArrowError {
  return {
    type: "exploration_query_error",
    message:
      cause instanceof Error
        ? cause.message
        : "ClickHouse could not build the exploration workspace",
    cause,
  };
}

async function countExplorationRows(
  request: ExplorationRequest,
  abortSignal: AbortSignal,
): Promise<number> {
  const compiled = compileExplorationCountQuery(request);
  const resultSet = await getClickHouseClient().query({
    query: compiled.query,
    query_params: compiled.queryParams,
    format: "JSONEachRow",
    abort_signal: abortSignal,
    clickhouse_settings: {
      max_execution_time: 20,
      max_memory_usage: "536870912",
      readonly: "1",
      optimize_move_to_prewhere: 1,
    },
  });
  const parsed = countRowsSchema.parse(await resultSet.json<unknown>());

  return parsed[0].row_count;
}

export function queryExplorationAsArrow(
  request: ExplorationRequest,
  abortSignal: AbortSignal,
): ResultAsync<ExplorationArrowResult, ExplorationArrowError> {
  if (activeExplorations >= 1) {
    return errAsync({
      type: "exploration_busy" as const,
      message: "Another high-volume workspace is being built; try again shortly",
    });
  }

  activeExplorations += 1;
  let released = false;
  const release = () => {
    if (!released) {
      released = true;
      activeExplorations -= 1;
    }
  };
  const result = ResultAsync.fromPromise(
    countExplorationRows(request, abortSignal),
    queryError,
  ).andThen((sourceRows) => {
    if (sourceRows > request.rowLimit) {
      return errAsync({
        type: "exploration_too_large" as const,
        message: `This workspace contains ${sourceRows.toLocaleString()} transactions; narrow the dates or location to stay within ${request.rowLimit.toLocaleString()}`,
        sourceRows,
        rowLimit: request.rowLimit,
      });
    }

    const compiled = compileAnalysisQuery(request);

    return ResultAsync.fromPromise(
      getClickHouseClient().exec({
        query: compiled.query,
        query_params: compiled.queryParams,
        abort_signal: abortSignal,
        clickhouse_settings: {
          max_execution_time: 20,
          max_result_rows: compiled.settings.max_result_rows,
          max_result_bytes: "33554432",
          max_memory_usage: "536870912",
          output_format_arrow_compression_method: "lz4_frame",
          result_overflow_mode: "throw",
          readonly: "1",
          optimize_move_to_prewhere: 1,
        },
      }),
      queryError,
    ).map((response) => {
      response.stream.once("close", release);
      response.stream.once("end", release);
      response.stream.once("error", release);

      return {
        stream: response.stream,
        queryId: response.query_id,
        sourceRows,
        responseHeaders: response.response_headers,
      };
    });
  });

  return result.mapErr((error) => {
    release();
    return error;
  });
}
