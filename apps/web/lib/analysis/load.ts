"use client";

import axios from "axios";
import { errAsync, ResultAsync } from "neverthrow";

import {
  decodeGrammarFrame,
  type GrammarFrame,
  type GrammarWasmError,
} from "@/lib/wasm/analysis";

import type {
  CategoricalRequest,
  HistogramRequest,
  MatrixRequest,
} from "./execution";

export type GrammarAnalysisRequest =
  | CategoricalRequest
  | HistogramRequest
  | MatrixRequest;

export type GrammarLoadResult = {
  readonly frame: GrammarFrame;
  readonly queryId: string | null;
  readonly arrowContract: string | null;
  readonly arrowBytes: number;
  readonly roundTripMs: number;
  readonly wasmStartupMs: number;
  readonly rustDecodeMs: number;
};

export type GrammarFetchError = {
  readonly kind: "analysis-fetch";
  readonly message: string;
  readonly cause: unknown;
};

export type GrammarLoadError = GrammarFetchError | GrammarWasmError;

function toFetchError(cause: unknown): GrammarFetchError {
  if (axios.isAxiosError(cause)) {
    return {
      kind: "analysis-fetch",
      message:
        cause.response === undefined
          ? "The analysis Arrow stream could not be loaded"
          : `The analysis endpoint returned HTTP ${cause.response.status}`,
      cause,
    };
  }

  return {
    kind: "analysis-fetch",
    message: cause instanceof Error ? cause.message : String(cause),
    cause,
  };
}

export function loadGrammarAnalysis(
  request: GrammarAnalysisRequest,
): ResultAsync<GrammarLoadResult, GrammarLoadError> {
  const startedAt = performance.now();

  return ResultAsync.fromPromise(
    axios.post<ArrayBuffer>("/api/arrow/analysis", request, {
      responseType: "arraybuffer",
      headers: {
        Accept: "application/vnd.apache.arrow.stream",
        "Content-Type": "application/json",
      },
    }),
    toFetchError,
  ).andThen((response) => {
    const receivedAt = performance.now();
    const bytes = new Uint8Array(response.data);
    const arrowContract =
      typeof response.headers["x-lens-arrow-contract"] === "string"
        ? response.headers["x-lens-arrow-contract"]
        : null;
    const expectedContract = `${request.shape}/v1`;

    if (arrowContract !== expectedContract) {
      return errAsync({
        kind: "analysis-fetch" as const,
        message: `Expected Arrow contract ${expectedContract}`,
        cause: arrowContract,
      });
    }

    return decodeGrammarFrame(bytes, request).map((decoded) => ({
      frame: decoded.frame,
      queryId:
        typeof response.headers["x-clickhouse-query-id"] === "string"
          ? response.headers["x-clickhouse-query-id"]
          : null,
      arrowContract,
      arrowBytes: bytes.byteLength,
      roundTripMs: receivedAt - startedAt,
      wasmStartupMs: decoded.startupWaitMs,
      rustDecodeMs: decoded.decodeMs,
    }));
  });
}
