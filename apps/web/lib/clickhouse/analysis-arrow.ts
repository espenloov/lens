import type { Readable } from "node:stream";

import type { ResponseHeaders } from "@clickhouse/client";
import { ResultAsync } from "neverthrow";

import { compileAnalysisQuery } from "@/lib/analysis/query-compiler";
import type { ExecutableAnalysisRequest } from "@/lib/analysis/execution";
import { getAnalysisDataSource } from "@/lib/data-sources/registry";
import { toAnalysisQuerySource } from "@/lib/data-sources/query-source";

import { getClickHouseClient } from "./client";

export type AnalysisArrowResult = {
  readonly stream: Readable;
  readonly queryId: string;
  readonly responseHeaders: ResponseHeaders;
};

export type AnalysisArrowQueryError = {
  readonly type: "analysis_arrow_query_error";
  readonly message: string;
  readonly cause: unknown;
};

function toAnalysisArrowQueryError(cause: unknown): AnalysisArrowQueryError {
  return {
    type: "analysis_arrow_query_error",
    message:
      cause instanceof Error
        ? cause.message
        : "ClickHouse could not produce the analysis Arrow stream",
    cause,
  };
}

export function queryAnalysisAsArrow(
  request: ExecutableAnalysisRequest,
): ResultAsync<AnalysisArrowResult, AnalysisArrowQueryError> {
  return getAnalysisDataSource(request.dataset, request.datasetVersion)
    .mapErr(toAnalysisArrowQueryError)
    .andThen((source) => {
      const compiled = compileAnalysisQuery(
        request,
        "baseline",
        toAnalysisQuerySource(source),
      );

      return ResultAsync.fromPromise(
        getClickHouseClient().exec({
          query: compiled.query,
          query_params: compiled.queryParams,
          clickhouse_settings: {
            max_execution_time: 20,
            max_result_rows: compiled.settings.max_result_rows,
            max_result_bytes: "16777216",
            max_rows_to_group_by: compiled.settings.max_rows_to_group_by,
            max_memory_usage: "536870912",
            group_by_overflow_mode: "throw",
            output_format_arrow_compression_method: "lz4_frame",
            output_format_arrow_string_as_string: 1,
            result_overflow_mode: "throw",
            readonly: "1",
            optimize_move_to_prewhere:
              compiled.settings.optimize_move_to_prewhere,
          },
        }),
        toAnalysisArrowQueryError,
      ).map((response) => ({
        stream: response.stream,
        queryId: response.query_id,
        responseHeaders: response.response_headers,
      }));
    });
}
