"use client";

import { err, ok, ResultAsync, type Result } from "neverthrow";

import type { TimeSeriesRequest } from "@/lib/time-series/contracts";

import initializeWasm, {
  decode_time_series_arrow,
  derive_anomaly_scores,
  derive_composition_shares,
  derive_period_changes,
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

export type TimeSeriesDerivedColumns =
  | {
      readonly kind: "period_change_percent" | "share";
      readonly values: Float64Array;
      readonly validity: Uint8Array;
    }
  | {
      readonly kind: "anomaly_score";
      readonly expected: Float64Array;
      readonly scores: Float64Array;
      readonly validity: Uint8Array;
      readonly flags: Uint8Array;
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

export function initializeLensWasm(): Promise<void> {
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
  return ResultAsync.fromPromise(initializeLensWasm(), toWasmError);
}

export function decodeTimeSeries(
  bytes: Uint8Array,
): ResultAsync<TimeSeriesDecodeResult, TimeSeriesWasmError> {
  const wasReady = ready;
  const startupWaitStartedAt = performance.now();

  return ResultAsync.fromPromise(
    initializeLensWasm().then(() => {
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

export function deriveTimeSeries(
  columns: TimeSeriesColumns,
  request: TimeSeriesRequest,
): Result<TimeSeriesDerivedColumns | null, TimeSeriesWasmError> {
  try {
    switch (request.transform) {
      case "value":
        return ok(null);

      case "period_change_percent": {
        const derived = derive_period_changes(
          columns.periodStarts,
          columns.seriesIndexes,
          columns.values,
          request.interval,
        );

        try {
          return ok({
            kind: "period_change_percent",
            values: derived.values(),
            validity: derived.validity(),
          });
        } finally {
          derived.free();
        }
      }

      case "share": {
        const derived = derive_composition_shares(
          columns.periodStarts,
          columns.values,
        );

        try {
          return ok({
            kind: "share",
            values: derived.values(),
            validity: derived.validity(),
          });
        } finally {
          derived.free();
        }
      }

      case "anomaly_score": {
        const derived = derive_anomaly_scores(
          columns.periodStarts,
          columns.seriesIndexes,
          columns.values,
          columns.observationCounts,
          request.interval,
          request.anomalyThreshold ?? 3.5,
        );

        try {
          return ok({
            kind: "anomaly_score",
            expected: derived.expected(),
            scores: derived.scores(),
            validity: derived.validity(),
            flags: derived.flags(),
          });
        } finally {
          derived.free();
        }
      }
    }
  } catch (cause) {
    return err(toWasmError(cause));
  }
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
