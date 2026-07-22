"use client";

import axios from "axios";
import { errAsync, ResultAsync } from "neverthrow";

import { ExplorationWorkerClient } from "@/lib/wasm/exploration-client";
import type { ExplorationWorkerLoadResult } from "@/lib/wasm/exploration-types";

import {
  explorationDayCount,
  explorationDimensions,
} from "./exploration-adapter";
import type { ExplorationRequest } from "./execution";

export type ExplorationLoadResult = ExplorationWorkerLoadResult & {
  readonly client: ExplorationWorkerClient;
  readonly arrowBytes: number;
  readonly roundTripMs: number;
  readonly queryId: string | null;
  readonly sourceRows: number;
  readonly analysisApiRequests: 1;
};

export type ExplorationLoadError = {
  readonly kind: "exploration-load";
  readonly message: string;
  readonly cause: unknown;
};

function decodeAxiosError(cause: unknown): ExplorationLoadError {
  if (!axios.isAxiosError(cause)) {
    return {
      kind: "exploration-load",
      message: cause instanceof Error ? cause.message : String(cause),
      cause,
    };
  }

  let message = "The exploration Arrow stream could not be loaded";

  if (cause.response?.data instanceof ArrayBuffer) {
    try {
      const payload = JSON.parse(new TextDecoder().decode(cause.response.data)) as {
        message?: unknown;
      };

      if (typeof payload.message === "string") {
        message = payload.message;
      }
    } catch {
      message = `The exploration endpoint returned HTTP ${cause.response.status}`;
    }
  }

  return { kind: "exploration-load", message, cause };
}

function workerError(cause: unknown): ExplorationLoadError {
  return {
    kind: "exploration-load",
    message: cause instanceof Error ? cause.message : String(cause),
    cause,
  };
}

export function loadExploration(
  request: ExplorationRequest,
  signal?: AbortSignal,
): ResultAsync<ExplorationLoadResult, ExplorationLoadError> {
  const startedAt = performance.now();

  return ResultAsync.fromPromise(
    axios.post<ArrayBuffer>("/api/arrow/exploration", request, {
      responseType: "arraybuffer",
      signal,
      headers: {
        Accept: "application/vnd.apache.arrow.stream",
        "Content-Type": "application/json",
      },
    }),
    decodeAxiosError,
  ).andThen((response) => {
    const receivedAt = performance.now();
    const contract = response.headers["x-lens-arrow-contract"];
    const sourceRowsHeader = response.headers["x-lens-source-rows"];
    const sourceRows =
      typeof sourceRowsHeader === "string" && /^\d+$/.test(sourceRowsHeader)
        ? Number(sourceRowsHeader)
        : Number.NaN;

    if (contract !== "exploration/v1" || !Number.isSafeInteger(sourceRows)) {
      return errAsync({
        kind: "exploration-load" as const,
        message: "The exploration endpoint returned an invalid contract",
        cause: { contract, sourceRows },
      });
    }

    const dimensions = explorationDimensions(request);
    const client = new ExplorationWorkerClient();
    const arrowBytes = response.data.byteLength;
    const abort = () => client.dispose("The exploration load was cancelled");

    signal?.addEventListener("abort", abort, { once: true });

    if (signal?.aborted === true) {
      abort();
    }

    return ResultAsync.fromPromise(
      client.load(response.data, {
        dayCount: explorationDayCount(request),
        binCount: request.binCount,
        bucketMinimum: request.bucketMinimum,
        bucketWidth: request.bucketWidth,
        cardinalities: dimensions.map(
          (dimension) => dimension.values.length,
        ) as [number, number, number],
      }),
      workerError,
    )
      .andThen((loaded) => {
        if (loaded.metadata.rowCount !== sourceRows) {
          client.dispose();

          return errAsync({
            kind: "exploration-load" as const,
            message: "The Arrow workspace row count did not match ClickHouse",
            cause: {
              expected: sourceRows,
              actual: loaded.metadata.rowCount,
            },
          });
        }

        client.activate();

        return ResultAsync.fromSafePromise(
          Promise.resolve({
            ...loaded,
            client,
            arrowBytes,
            roundTripMs: receivedAt - startedAt,
            queryId:
              typeof response.headers["x-clickhouse-query-id"] === "string"
                ? response.headers["x-clickhouse-query-id"]
                : null,
            sourceRows,
            analysisApiRequests: 1 as const,
          }),
        );
      })
      .mapErr((error) => {
        client.dispose();
        return error;
      });
  });
}
