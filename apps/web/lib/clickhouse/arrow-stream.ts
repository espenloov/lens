import type { Readable } from "node:stream";

import type { ResponseHeaders } from "@clickhouse/client";
import { ResultAsync } from "neverthrow";

import type { QueryStrategy } from "@/lib/query-arena/contracts";
import type { TimeSeriesRequest } from "@/lib/time-series/contracts";
import { compileTimeSeriesQuery } from "@/lib/time-series/query-compiler";
import { getAnalysisDataSource } from "@/lib/data-sources/registry";
import { toAnalysisQuerySource } from "@/lib/data-sources/query-source";

import { getClickHouseClient } from "./client";

export type ArrowStreamResult = {
  readonly stream: Readable;
  readonly queryId: string;
  readonly responseHeaders: ResponseHeaders;
  readonly summary:
    | {
        readonly read_rows: string;
        readonly read_bytes: string;
        readonly elapsed_ns: string;
      }
    | undefined;
};

export type ArrowStreamQueryOptions = {
  readonly strategy?: QueryStrategy;
  readonly benchmark?: boolean;
};

export type ArrowStreamQueryError = {
  readonly type: "arrow_stream_query_error";
  readonly message: string;
  readonly cause: unknown;
};

function toArrowStreamQueryError(cause: unknown): ArrowStreamQueryError {
  return {
    type: "arrow_stream_query_error",
    message:
      cause instanceof Error
        ? cause.message
        : "ClickHouse could not produce the Arrow stream",
    cause,
  };
}

export function queryTimeSeriesAsArrow(
  request: TimeSeriesRequest,
  options: ArrowStreamQueryOptions = {},
): ResultAsync<ArrowStreamResult, ArrowStreamQueryError> {
  return getAnalysisDataSource(request.dataset, request.datasetVersion)
    .mapErr(toArrowStreamQueryError)
    .andThen((source) => {
      const compiled = compileTimeSeriesQuery(
        request,
        options.strategy ?? "baseline",
        toAnalysisQuerySource(source),
      );

      return ResultAsync.fromPromise(
        getClickHouseClient().exec({
          query: compiled.query,
          query_params: compiled.queryParams,
          clickhouse_settings: {
            max_execution_time: 15,
            max_result_rows: compiled.settings.max_result_rows,
            max_result_bytes: "16777216",
            max_rows_to_group_by: compiled.settings.max_rows_to_group_by,
            group_by_overflow_mode: "throw",
            max_memory_usage: "536870912",
            output_format_arrow_compression_method: "lz4_frame",
            output_format_arrow_string_as_string: 1,
            result_overflow_mode: "throw",
            readonly: "1",
            optimize_move_to_prewhere:
              compiled.settings.optimize_move_to_prewhere,
            ...(options.benchmark ? { use_query_cache: 0 } : {}),
          },
        }),
        toArrowStreamQueryError,
      ).map((response) => ({
        stream: response.stream,
        queryId: response.query_id,
        responseHeaders: response.response_headers,
        summary: response.summary,
      }));
    });
}
