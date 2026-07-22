import type { Readable } from "node:stream";

import { errAsync, okAsync, ResultAsync } from "neverthrow";

import { queryTimeSeriesAsArrow } from "@/lib/clickhouse/arrow-stream";
import type { TimeSeriesRequest } from "@/lib/time-series/contracts";
import { fingerprintArrow } from "@/lib/wasm/node-verifier";

import type {
  QueryBenchmarkTrial,
  QueryStrategy,
} from "./contracts";

const MAXIMUM_ARROW_BYTES = 512 * 1024;

export type QueryBenchmarkError = {
  readonly type:
    | "query_failed"
    | "result_too_large"
    | "invalid_summary"
    | "fingerprint_failed";
  readonly message: string;
  readonly cause?: unknown;
};

function parseSummaryInteger(value: string | undefined): number | null {
  if (value === undefined) {
    return null;
  }

  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

async function collectArrowBytes(stream: Readable): Promise<Uint8Array> {
  const chunks: Buffer[] = [];
  let byteLength = 0;

  for await (const chunk of stream) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    byteLength += bytes.byteLength;

    if (byteLength > MAXIMUM_ARROW_BYTES) {
      stream.destroy();
      throw new Error("The benchmark Arrow result exceeded 512 KiB");
    }

    chunks.push(bytes);
  }

  return Buffer.concat(chunks, byteLength);
}

export function benchmarkQueryStrategy(
  request: TimeSeriesRequest,
  strategy: QueryStrategy,
): ResultAsync<QueryBenchmarkTrial, QueryBenchmarkError> {
  const startedAt = performance.now();

  return queryTimeSeriesAsArrow(request, {
    strategy,
    benchmark: true,
  })
    .mapErr((error) => ({
      type: "query_failed" as const,
      message: error.message,
      cause: error.cause,
    }))
    .andThen((response) =>
      ResultAsync.fromPromise(collectArrowBytes(response.stream), (cause) => ({
        type: "result_too_large" as const,
        message:
          cause instanceof Error
            ? cause.message
            : "The benchmark result could not be buffered",
        cause,
      })).andThen((bytes) => {
        const fingerprint = fingerprintArrow(bytes);

        if (fingerprint.isErr()) {
          return errAsync({
            type: "fingerprint_failed" as const,
            message: fingerprint.error.message,
            cause: fingerprint.error.cause,
          });
        }

        const elapsedNanoseconds = Number(response.summary?.elapsed_ns);
        const serverElapsedMs = Number.isFinite(elapsedNanoseconds)
          ? elapsedNanoseconds / 1_000_000
          : null;

        return okAsync({
          metrics: {
            queryId: response.queryId,
            roundTripMs: performance.now() - startedAt,
            serverElapsedMs,
            rowsRead: parseSummaryInteger(response.summary?.read_rows),
            bytesRead: parseSummaryInteger(response.summary?.read_bytes),
            arrowBytes: bytes.byteLength,
          },
          fingerprint: fingerprint.value,
        });
      }),
    );
}
