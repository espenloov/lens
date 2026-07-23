"use client";

import { err, ok, ResultAsync, type Result } from "neverthrow";

import type { SemanticAnalysisRequest } from "@/lib/analysis/semantic-plan";

import {
  decode_category_arrow,
  decode_histogram_arrow,
  derive_anomaly_scores,
  derive_composition_shares,
} from "./lens/lens_wasm";
import {
  decodeTimeSeries,
  initializeLensWasm,
  type TimeSeriesColumns,
  type TimeSeriesDerivedColumns,
} from "./time-series";
import type { CategoryFrame, HistogramFrame } from "./analysis";

export type SemanticFrame =
  | {
      readonly kind: "time_series";
      readonly columns: TimeSeriesColumns;
      readonly derived: TimeSeriesDerivedColumns | null;
    }
  | CategoryFrame
  | HistogramFrame;

export type SemanticWasmResult = {
  readonly frame: SemanticFrame;
  readonly startupWaitMs: number;
  readonly decodeMs: number;
  readonly transformMs: number;
};

export type SemanticWasmError = {
  readonly kind: "semantic-wasm";
  readonly message: string;
  readonly cause: unknown;
};

function toWasmError(cause: unknown): SemanticWasmError {
  return {
    kind: "semantic-wasm",
    message: cause instanceof Error ? cause.message : String(cause),
    cause,
  };
}

function deriveTimeSeries(
  columns: TimeSeriesColumns,
  request: SemanticAnalysisRequest,
): Result<TimeSeriesDerivedColumns | null, SemanticWasmError> {
  try {
    if (request.transform === "value") {
      return ok(null);
    }

    if (request.transform === "share") {
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

    if (request.plan.operation !== "anomaly") {
      return err(
        toWasmError(
          new Error("Anomaly transforms require an anomaly analysis plan"),
        ),
      );
    }

    const derived = derive_anomaly_scores(
      columns.periodStarts,
      columns.seriesIndexes,
      columns.values,
      columns.observationCounts,
      request.plan.interval,
      request.plan.threshold,
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
  } catch (cause) {
    return err(toWasmError(cause));
  }
}

function decodeCategory(
  bytes: Uint8Array,
): CategoryFrame {
  const data = decode_category_arrow(bytes);

  try {
    const categories = Array.from(
      { length: data.row_count },
      (_, index) => data.category(index) ?? `Category ${index + 1}`,
    );
    const rawValues = data.values();

    return {
      kind: "categorical",
      categories,
      values: rawValues,
      rawValues,
      observationCounts: data.observation_counts(),
    };
  } finally {
    data.free();
  }
}

function transformCategory(
  frame: CategoryFrame,
  transform: SemanticAnalysisRequest["transform"],
): CategoryFrame {
  if (transform !== "share") {
    return frame;
  }

  const periods = new Int32Array(frame.rawValues.length);
  const shares = derive_composition_shares(periods, frame.rawValues);

  try {
    return {
      ...frame,
      values: shares.values(),
    };
  } finally {
    shares.free();
  }
}

function decodeHistogram(bytes: Uint8Array): HistogramFrame {
  const data = decode_histogram_arrow(bytes);

  try {
    return {
      kind: "histogram",
      binStarts: data.bin_starts(),
      binEnds: data.bin_ends(),
      seriesIndexes: data.series_indexes(),
      seriesNames: Array.from(
        { length: data.series_count },
        (_, index) => data.series_name(index) ?? `Series ${index + 1}`,
      ),
      values: data.values(),
      observationCounts: data.observation_counts(),
    };
  } finally {
    data.free();
  }
}

export function decodeSemanticFrame(
  bytes: Uint8Array,
  request: SemanticAnalysisRequest,
): ResultAsync<SemanticWasmResult, SemanticWasmError> {
  if (request.shape === "time_series") {
    return decodeTimeSeries(bytes)
      .mapErr((error) => toWasmError(error.cause))
      .andThen((decoded) => {
        const transformStartedAt = performance.now();

        return deriveTimeSeries(decoded.columns, request).map((derived) => ({
          frame: {
            kind: "time_series" as const,
            columns: decoded.columns,
            derived,
          },
          startupWaitMs: decoded.timing.startupWaitMs,
          decodeMs: decoded.timing.decodeMs,
          transformMs: performance.now() - transformStartedAt,
        }));
      });
  }

  const startupStartedAt = performance.now();

  return ResultAsync.fromPromise(
    initializeLensWasm().then(() => {
      const decodeStartedAt = performance.now();
      const decoded =
        request.shape === "categorical"
          ? decodeCategory(bytes)
          : decodeHistogram(bytes);
      const transformStartedAt = performance.now();
      const frame =
        decoded.kind === "categorical"
          ? transformCategory(decoded, request.transform)
          : decoded;

      return {
        frame,
        startupWaitMs: decodeStartedAt - startupStartedAt,
        decodeMs: transformStartedAt - decodeStartedAt,
        transformMs: performance.now() - transformStartedAt,
      };
    }),
    toWasmError,
  );
}
