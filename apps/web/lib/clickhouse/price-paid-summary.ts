import { err, ok, ResultAsync } from "neverthrow";
import { z } from "zod";

import { getClickHouseClient } from "./client";

const summaryRowsSchema = z
  .array(
    z.object({
      transaction_count: z.coerce.number().int().nonnegative(),
      earliest_sale: z.iso.date(),
      latest_sale: z.iso.date(),
      average_price: z.coerce.number().nonnegative(),
    }),
  )
  .length(1);

export type PricePaidSummary = {
  readonly transactionCount: number;
  readonly earliestSale: string;
  readonly latestSale: string;
  readonly averagePrice: number;
};

export type PricePaidSummaryError =
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

function toQueryError(cause: unknown): PricePaidSummaryError {
  return {
    type: "clickhouse_query_error",
    message:
      cause instanceof Error
        ? cause.message
        : "The property summary query failed",
    cause,
  };
}

async function querySummary(): Promise<unknown> {
  const resultSet = await getClickHouseClient().query({
    query: `
      SELECT
        count() AS transaction_count,
        min(date) AS earliest_sale,
        max(date) AS latest_sale,
        round(avg(price)) AS average_price
      FROM pp_complete
    `,
    format: "JSONEachRow",
  });

  return resultSet.json<unknown>();
}

export function getPricePaidSummary(): ResultAsync<
  PricePaidSummary,
  PricePaidSummaryError
> {
  return ResultAsync.fromPromise(querySummary(), toQueryError).andThen(
    (response) => {
      const parsed = summaryRowsSchema.safeParse(response);

      if (!parsed.success) {
        return err({
          type: "invalid_clickhouse_response" as const,
          message: "ClickHouse returned an unexpected summary",
          cause: parsed.error,
        });
      }

      const [row] = parsed.data;

      return ok({
        transactionCount: row.transaction_count,
        earliestSale: row.earliest_sale,
        latestSale: row.latest_sale,
        averagePrice: row.average_price,
      });
    },
  );
}
