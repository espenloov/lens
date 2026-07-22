import type { Readable } from "node:stream";

import type { ResponseHeaders } from "@clickhouse/client";
import { ResultAsync } from "neverthrow";

import type { TimeSeriesRequest } from "@/lib/time-series/contracts";
import { compileTimeSeriesQuery } from "@/lib/time-series/query-compiler";

import { getClickHouseClient } from "./client";

export type ArrowStreamResult = {
  readonly stream: Readable;
  readonly queryId: string;
  readonly responseHeaders: ResponseHeaders;
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
): ResultAsync<ArrowStreamResult, ArrowStreamQueryError> {
  const compiled = compileTimeSeriesQuery(request);

  return ResultAsync.fromPromise(
    getClickHouseClient().exec({
      query: compiled.query,
      query_params: compiled.queryParams,
      clickhouse_settings: {
        max_execution_time: 15,
        max_result_rows: "2000",
        output_format_arrow_compression_method: "lz4_frame",
        output_format_arrow_string_as_string: 1,
        result_overflow_mode: "throw",
      },
    }),
    toArrowStreamQueryError,
  ).map((response) => ({
    stream: response.stream,
    queryId: response.query_id,
    responseHeaders: response.response_headers,
  }));
}
