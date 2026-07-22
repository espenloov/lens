import type { Readable } from "node:stream";

import type { ResponseHeaders } from "@clickhouse/client";
import { ResultAsync } from "neverthrow";

import { getClickHouseClient } from "./client";

const YEARLY_PRICE_ARROW_QUERY = `
  SELECT
    toUInt16(toYear(date)) AS year,
    toUInt64(round(avg(price))) AS average_price,
    toUInt64(count()) AS transaction_count
  FROM pp_complete
  WHERE date >= {dateFrom: Date}
    AND date <= {dateTo: Date}
    AND town = {town: String}
  GROUP BY year
  ORDER BY year ASC
  FORMAT ArrowStream
`;

export type YearlyPriceArrowInput = {
  readonly dateFrom: string;
  readonly dateTo: string;
  readonly town: string;
};

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

export function queryYearlyPricesAsArrow(
  input: YearlyPriceArrowInput,
): ResultAsync<ArrowStreamResult, ArrowStreamQueryError> {
  return ResultAsync.fromPromise(
    getClickHouseClient().exec({
      query: YEARLY_PRICE_ARROW_QUERY,
      query_params: {
        dateFrom: input.dateFrom,
        dateTo: input.dateTo,
        town: input.town.toUpperCase(),
      },
      clickhouse_settings: {
        max_execution_time: 10,
        max_result_rows: "30",
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
