import { err, errAsync, fromThrowable, ok, ResultAsync } from "neverthrow";
import { z } from "zod";

import { getClickHouseClient } from "@/lib/clickhouse/client";

import type { AnalysisPlan } from "./contracts";
import {
  compileAnalysisQuery,
  type CompiledAnalysisQuery,
  type UnsupportedAnalysisPlanError,
} from "./query-compiler";
import {
  yearlyAveragePriceResultSchema,
  type YearlyAveragePriceResult,
} from "./results";

const yearlyAveragePriceRowsSchema = z
  .array(
    z.object({
      year: z.coerce.number().int(),
      average_price: z.coerce.number().int().nonnegative(),
      transaction_count: z.coerce.number().int().positive(),
    }),
  )
  .max(30);

const clickHouseSummarySchema = z.object({
  read_rows: z.coerce.number().int().nonnegative(),
  read_bytes: z.coerce.number().int().nonnegative(),
  elapsed_ns: z.coerce.number().int().nonnegative(),
});

type ClickHouseQueryResponse = {
  readonly rows: unknown;
  readonly queryId: string;
  readonly summary: z.infer<typeof clickHouseSummarySchema> | null;
};

const parseJson = fromThrowable(
  (value: string): unknown => JSON.parse(value),
  () => null,
);

export type AnalysisExecutionError =
  | UnsupportedAnalysisPlanError
  | {
      readonly type: "clickhouse_query_error";
      readonly message: string;
      readonly cause: unknown;
    }
  | {
      readonly type: "invalid_clickhouse_response";
      readonly message: string;
      readonly cause: z.ZodError;
    };

function toQueryError(cause: unknown): AnalysisExecutionError {
  return {
    type: "clickhouse_query_error",
    message:
      cause instanceof Error
        ? cause.message
        : "The ClickHouse analysis query failed",
    cause,
  };
}

async function queryClickHouse(
  compiled: CompiledAnalysisQuery,
): Promise<ClickHouseQueryResponse> {
  const resultSet = await getClickHouseClient().query({
    query: compiled.query,
    query_params: compiled.queryParams,
    format: "JSONEachRow",
    clickhouse_settings: {
      max_execution_time: 10,
      max_result_rows: "30",
      result_overflow_mode: "throw",
      wait_end_of_query: 1,
    },
  });

  const rows = await resultSet.json<unknown>();
  const summaryHeader = resultSet.response_headers["x-clickhouse-summary"];
  const rawSummary =
    typeof summaryHeader === "string"
      ? parseJson(summaryHeader).unwrapOr(null)
      : null;
  const summary = clickHouseSummarySchema.safeParse(rawSummary);

  return {
    rows,
    queryId: resultSet.query_id,
    summary: summary.success ? summary.data : null,
  };
}

export function executeAnalysisPlan(
  plan: AnalysisPlan,
): ResultAsync<YearlyAveragePriceResult, AnalysisExecutionError> {
  const compiled = compileAnalysisQuery(plan);

  if (compiled.isErr()) {
    return errAsync<YearlyAveragePriceResult, AnalysisExecutionError>(
      compiled.error,
    );
  }

  const startedAt = Date.now();

  return ResultAsync.fromPromise(
    queryClickHouse(compiled.value),
    toQueryError,
  ).andThen((response) => {
    const rows = yearlyAveragePriceRowsSchema.safeParse(response.rows);

    if (!rows.success) {
      return err({
        type: "invalid_clickhouse_response" as const,
        message: "ClickHouse returned unexpected analysis rows",
        cause: rows.error,
      });
    }

    const result = yearlyAveragePriceResultSchema.safeParse({
      kind: "yearly_average_price",
      points: rows.data.map((row) => ({
        year: row.year,
        averagePrice: row.average_price,
        transactionCount: row.transaction_count,
      })),
      queryId: response.queryId,
      performance: {
        roundTripMs: Date.now() - startedAt,
        serverElapsedMs:
          response.summary === null
            ? null
            : response.summary.elapsed_ns / 1_000_000,
        rowsRead: response.summary?.read_rows ?? null,
        bytesRead: response.summary?.read_bytes ?? null,
      },
      calculatedAt: new Date().toISOString(),
    });

    if (!result.success) {
      return err({
        type: "invalid_clickhouse_response" as const,
        message: "The analysis result did not match its contract",
        cause: result.error,
      });
    }

    return ok(result.data);
  });
}
