"use client";

import { ResultAsync } from "neverthrow";

import type {
  CategoricalRequest,
  HistogramRequest,
  MatrixRequest,
} from "@/lib/analysis/execution";

import {
  decode_category_arrow,
  decode_histogram_arrow,
  decode_matrix_arrow,
  derive_composition_shares,
} from "./lens/lens_wasm";
import { initializeLensWasm } from "./time-series";

export type CategoryFrame = {
  readonly kind: "categorical";
  readonly categories: readonly string[];
  readonly values: Float64Array;
  readonly rawValues: Float64Array;
  readonly observationCounts: BigUint64Array;
};

export type HistogramFrame = {
  readonly kind: "histogram";
  readonly binStarts: Float64Array;
  readonly binEnds: Float64Array;
  readonly seriesIndexes: Uint32Array;
  readonly seriesNames: readonly string[];
  readonly values: Float64Array;
  readonly observationCounts: BigUint64Array;
};

export type MatrixFrame = {
  readonly kind: "matrix";
  readonly xIndexes: Uint32Array;
  readonly xLabels: readonly string[];
  readonly yIndexes: Uint32Array;
  readonly yLabels: readonly string[];
  readonly values: Float64Array;
  readonly observationCounts: BigUint64Array;
};

export type GrammarFrame = CategoryFrame | HistogramFrame | MatrixFrame;

export type GrammarWasmResult = {
  readonly frame: GrammarFrame;
  readonly startupWaitMs: number;
  readonly decodeMs: number;
};

export type GrammarWasmError = {
  readonly kind: "analysis-wasm";
  readonly message: string;
  readonly cause: unknown;
};

function toWasmError(cause: unknown): GrammarWasmError {
  return {
    kind: "analysis-wasm",
    message: cause instanceof Error ? cause.message : String(cause),
    cause,
  };
}

function decodeCategory(
  bytes: Uint8Array,
  request: CategoricalRequest,
): CategoryFrame {
  const data = decode_category_arrow(bytes);

  try {
    const categories = Array.from(
      { length: data.row_count },
      (_, index) => data.category(index) ?? `Category ${index + 1}`,
    );
    const rawValues = data.values();
    let values = rawValues;

    if (request.transform === "share") {
      const periods = new Int32Array(rawValues.length);
      const shares = derive_composition_shares(periods, rawValues);

      try {
        values = shares.values();
      } finally {
        shares.free();
      }
    }

    return {
      kind: "categorical",
      categories,
      values,
      rawValues,
      observationCounts: data.observation_counts(),
    };
  } finally {
    data.free();
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

function decodeMatrix(bytes: Uint8Array): MatrixFrame {
  const data = decode_matrix_arrow(bytes);

  try {
    return {
      kind: "matrix",
      xIndexes: data.x_indexes(),
      xLabels: Array.from(
        { length: data.x_count },
        (_, index) => data.x_label(index) ?? `X ${index + 1}`,
      ),
      yIndexes: data.y_indexes(),
      yLabels: Array.from(
        { length: data.y_count },
        (_, index) => data.y_label(index) ?? `Y ${index + 1}`,
      ),
      values: data.values(),
      observationCounts: data.observation_counts(),
    };
  } finally {
    data.free();
  }
}

export function decodeGrammarFrame(
  bytes: Uint8Array,
  request: CategoricalRequest | HistogramRequest | MatrixRequest,
): ResultAsync<GrammarWasmResult, GrammarWasmError> {
  const startupStartedAt = performance.now();

  return ResultAsync.fromPromise(
    initializeLensWasm().then(() => {
      const decodeStartedAt = performance.now();
      const frame = (() => {
        switch (request.shape) {
          case "categorical":
            return decodeCategory(bytes, request);
          case "histogram":
            return decodeHistogram(bytes);
          case "matrix":
            return decodeMatrix(bytes);
        }
      })();

      return {
        frame,
        startupWaitMs: decodeStartedAt - startupStartedAt,
        decodeMs: performance.now() - decodeStartedAt,
      };
    }),
    toWasmError,
  );
}
