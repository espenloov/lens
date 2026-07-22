"use client";

import { ResultAsync } from "neverthrow";

import initializeWasm, {
  analyze_time_series_arrow,
} from "./lens/lens_wasm";

export type TimeSeriesWasmResult = {
  readonly rowCount: number;
  readonly seriesCount: number;
  readonly minimumValue: number | null;
  readonly maximumValue: number | null;
};

export type TimeSeriesWasmError = {
  readonly kind: "time-series-wasm";
  readonly message: string;
  readonly cause: unknown;
};

let initialization: Promise<void> | undefined;

function initializeTimeSeriesWasm(): Promise<void> {
  if (!initialization) {
    initialization = initializeWasm()
      .then(() => undefined)
      .catch((cause: unknown) => {
        initialization = undefined;
        throw cause;
      });
  }

  return initialization;
}

function describeError(cause: unknown): string {
  if (cause instanceof Error) {
    return cause.message;
  }

  return String(cause);
}

export function analyzeTimeSeries(
  bytes: Uint8Array,
): ResultAsync<TimeSeriesWasmResult, TimeSeriesWasmError> {
  return ResultAsync.fromPromise(
    initializeTimeSeriesWasm().then(() => {
      const analysis = analyze_time_series_arrow(bytes);

      try {
        return {
          rowCount: analysis.row_count,
          seriesCount: analysis.series_count,
          minimumValue: analysis.minimum_value ?? null,
          maximumValue: analysis.maximum_value ?? null,
        };
      } finally {
        analysis.free();
      }
    }),
    (cause): TimeSeriesWasmError => ({
      kind: "time-series-wasm",
      message: describeError(cause),
      cause,
    }),
  );
}
