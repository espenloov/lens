"use client";

import { ResultAsync } from "neverthrow";

import initializeWasm, {
  decode_time_series_arrow,
} from "./lens/lens_wasm";

export type TimeSeriesColumns = {
  readonly rowCount: number;
  readonly seriesCount: number;
  readonly periodStarts: Int32Array;
  readonly seriesIndexes: Uint32Array;
  readonly values: Float64Array;
  readonly observationCounts: BigUint64Array;
  readonly seriesNames: readonly string[];
};

export type TimeSeriesWasmTiming = {
  readonly startupWaitMs: number;
  readonly decodeMs: number;
  readonly wasReady: boolean;
};

export type TimeSeriesDecodeResult = {
  readonly columns: TimeSeriesColumns;
  readonly timing: TimeSeriesWasmTiming;
};

export type TimeSeriesWasmResult = TimeSeriesColumns & {
  readonly minimumValue: number | null;
  readonly maximumValue: number | null;
  readonly timing: TimeSeriesWasmTiming;
};

export type TimeSeriesWasmError = {
  readonly kind: "time-series-wasm";
  readonly message: string;
  readonly cause: unknown;
};

let initialization: Promise<void> | undefined;
let ready = false;

function initializeTimeSeriesWasm(): Promise<void> {
  if (!initialization) {
    initialization = initializeWasm()
      .then(() => {
        ready = true;
      })
      .catch((cause: unknown) => {
        initialization = undefined;
        ready = false;
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

function toWasmError(cause: unknown): TimeSeriesWasmError {
  return {
    kind: "time-series-wasm",
    message: describeError(cause),
    cause,
  };
}

export function preloadTimeSeriesWasm(): ResultAsync<
  void,
  TimeSeriesWasmError
> {
  return ResultAsync.fromPromise(initializeTimeSeriesWasm(), toWasmError);
}

export function decodeTimeSeries(
  bytes: Uint8Array,
): ResultAsync<TimeSeriesDecodeResult, TimeSeriesWasmError> {
  const wasReady = ready;
  const startupWaitStartedAt = performance.now();

  return ResultAsync.fromPromise(
    initializeTimeSeriesWasm().then(() => {
      const startupWaitMs = wasReady
        ? 0
        : performance.now() - startupWaitStartedAt;
      const decodeStartedAt = performance.now();
      const data = decode_time_series_arrow(bytes);

      try {
        const seriesNames = Array.from(
          { length: data.series_count },
          (_, index) => data.series_name(index) ?? `Series ${index + 1}`,
        );

        const columns = {
          rowCount: data.row_count,
          seriesCount: data.series_count,
          periodStarts: data.period_starts(),
          seriesIndexes: data.series_indexes(),
          values: data.values(),
          observationCounts: data.observation_counts(),
          seriesNames,
        };

        return {
          columns,
          timing: {
            startupWaitMs,
            decodeMs: performance.now() - decodeStartedAt,
            wasReady,
          },
        };
      } finally {
        data.free();
      }
    }),
    toWasmError,
  );
}

export function analyzeTimeSeries(
  bytes: Uint8Array,
): ResultAsync<TimeSeriesWasmResult, TimeSeriesWasmError> {
  return decodeTimeSeries(bytes).map(({ columns, timing }) => {
    let minimumValue: number | null = null;
    let maximumValue: number | null = null;

    for (const value of columns.values) {
      minimumValue = minimumValue === null ? value : Math.min(minimumValue, value);
      maximumValue = maximumValue === null ? value : Math.max(maximumValue, value);
    }

    return {
      ...columns,
      minimumValue,
      maximumValue,
      timing,
    };
  });
}
