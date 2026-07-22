"use client";

import axios from "axios";
import { ResultAsync } from "neverthrow";

import {
  decodeTimeSeries,
  type TimeSeriesColumns,
  type TimeSeriesWasmError,
} from "@/lib/wasm/time-series";
import {
  queryStrategySchema,
  type QueryStrategy,
} from "@/lib/query-arena/contracts";

import type { TimeSeriesRequest } from "./contracts";
import {
  calculateTimeSeriesPerformance,
  type TimeSeriesPerformance,
} from "./performance";

export type TimeSeriesLoadResult = {
  readonly columns: TimeSeriesColumns;
  readonly queryId: string | null;
  readonly analysisSignature: string | null;
  readonly strategy: QueryStrategy;
  readonly arrowBytes: number;
  readonly performance: TimeSeriesPerformance;
};

export type TimeSeriesFetchError = {
  readonly kind: "time-series-fetch";
  readonly message: string;
  readonly cause: unknown;
};

export type TimeSeriesLoadError = TimeSeriesFetchError | TimeSeriesWasmError;

function toFetchError(cause: unknown): TimeSeriesFetchError {
  if (axios.isAxiosError(cause)) {
    return {
      kind: "time-series-fetch",
      message:
        cause.response === undefined
          ? "The Arrow stream could not be loaded"
          : `The Arrow endpoint returned HTTP ${cause.response.status}`,
      cause,
    };
  }

  return {
    kind: "time-series-fetch",
    message: cause instanceof Error ? cause.message : String(cause),
    cause,
  };
}

export function loadTimeSeries(
  request: TimeSeriesRequest,
): ResultAsync<TimeSeriesLoadResult, TimeSeriesLoadError> {
  const startedAt = performance.now();

  return ResultAsync.fromPromise(
    axios.post<ArrayBuffer>("/api/arrow/time-series", request, {
      responseType: "arraybuffer",
      headers: {
        Accept: "application/vnd.apache.arrow.stream",
        "Content-Type": "application/json",
      },
    }),
    toFetchError,
  ).andThen((response) => {
    const bytes = new Uint8Array(response.data);
    const responseReceivedAt = performance.now();

    return decodeTimeSeries(bytes).map((decoded) => ({
      columns: decoded.columns,
      queryId:
        typeof response.headers["x-clickhouse-query-id"] === "string"
          ? response.headers["x-clickhouse-query-id"]
          : null,
      analysisSignature:
        typeof response.headers["x-lens-analysis-signature"] === "string"
          ? response.headers["x-lens-analysis-signature"]
          : null,
      strategy:
        queryStrategySchema.safeParse(
          response.headers["x-lens-query-strategy"],
        ).data ?? "baseline",
      arrowBytes: bytes.byteLength,
      performance: calculateTimeSeriesPerformance({
        requestStartedAt: startedAt,
        responseReceivedAt,
        wasm: decoded.timing,
      }),
    }));
  });
}
