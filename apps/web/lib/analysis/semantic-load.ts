"use client";

import axios from "axios";
import { errAsync, ResultAsync } from "neverthrow";

import {
  decodeSemanticFrame,
  type SemanticWasmError,
} from "@/lib/wasm/semantic-analysis";

import type { SemanticAnalysisRequest } from "./semantic-plan";
import { queryStrategySchema, type QueryStrategy } from "../query-arena/contracts";
import {
  toSemanticVisualModel,
  type SemanticAdapterError,
  type SemanticVisualModel,
} from "./semantic-result";

export type SemanticLoadResult = {
  readonly model: SemanticVisualModel;
  readonly queryId: string | null;
  readonly arrowContract: string;
  readonly arrowBytes: number;
  readonly roundTripMs: number;
  readonly wasmStartupMs: number;
  readonly rustDecodeMs: number;
  readonly rustTransformMs: number;
  readonly strategy: QueryStrategy;
};

export type SemanticFetchError = {
  readonly kind: "semantic-fetch";
  readonly message: string;
  readonly cause: unknown;
};

export type SemanticLoadError =
  | SemanticFetchError
  | SemanticWasmError
  | SemanticAdapterError;

function toFetchError(cause: unknown): SemanticFetchError {
  if (axios.isAxiosError(cause)) {
    return {
      kind: "semantic-fetch",
      message:
        cause.response === undefined
          ? "The semantic Arrow stream could not be loaded"
          : `The semantic analysis endpoint returned HTTP ${cause.response.status}`,
      cause,
    };
  }

  return {
    kind: "semantic-fetch",
    message: cause instanceof Error ? cause.message : String(cause),
    cause,
  };
}

export function loadSemanticAnalysis(
  request: SemanticAnalysisRequest,
): ResultAsync<SemanticLoadResult, SemanticLoadError> {
  const startedAt = performance.now();

  return ResultAsync.fromPromise(
    axios.post<ArrayBuffer>("/api/arrow/semantic", request, {
      responseType: "arraybuffer",
      headers: {
        Accept: "application/vnd.apache.arrow.stream",
        "Content-Type": "application/json",
      },
    }),
    toFetchError,
  ).andThen((response) => {
    const receivedAt = performance.now();
    const arrowContract =
      typeof response.headers["x-lens-arrow-contract"] === "string"
        ? response.headers["x-lens-arrow-contract"]
        : null;
    const expectedContract = `${request.shape}/v1`;
    const strategy = queryStrategySchema.safeParse(
      response.headers["x-lens-query-strategy"] ?? "baseline",
    );

    if (arrowContract !== expectedContract) {
      return errAsync({
        kind: "semantic-fetch" as const,
        message: `Expected Arrow contract ${expectedContract}`,
        cause: arrowContract,
      });
    }

    if (!strategy.success) {
      return errAsync({
        kind: "semantic-fetch" as const,
        message: "The semantic endpoint returned an invalid query strategy",
        cause: response.headers["x-lens-query-strategy"],
      });
    }

    const bytes = new Uint8Array(response.data);

    return decodeSemanticFrame(bytes, request).andThen((decoded) =>
      toSemanticVisualModel(request, decoded.frame).map((model) => ({
          model,
          queryId:
            typeof response.headers["x-clickhouse-query-id"] === "string"
              ? response.headers["x-clickhouse-query-id"]
              : null,
          arrowContract,
          arrowBytes: bytes.byteLength,
          roundTripMs: receivedAt - startedAt,
          wasmStartupMs: decoded.startupWaitMs,
          rustDecodeMs: decoded.decodeMs,
          rustTransformMs: decoded.transformMs,
          strategy: strategy.data,
        })),
      );
  });
}
