import { errAsync, okAsync, ResultAsync } from "neverthrow";
import { z } from "zod";

import { getClickHouseClient } from "../../clickhouse/client";
import type { AnalysisDataSource } from "../../data-sources/contracts";

import type {
  TuningProjectionDdl,
  TuningValidation,
} from "./contracts";

const relationRowsSchema = z.array(
  z.object({
    engine: z.string(),
    source_bytes: z.coerce.number().int().nonnegative().nullable(),
    columns: z.array(z.string()),
    projection_names: z.array(z.string()),
  }),
);

export type TuningValidationError = {
  readonly type: "tuning_validation_error";
  readonly message: string;
  readonly cause: unknown;
};

function validationError(cause: unknown): TuningValidationError {
  return {
    type: "tuning_validation_error",
    message:
      cause instanceof Error
        ? cause.message
        : "The projection proposal could not be validated",
    cause,
  };
}

export function validateProjectionProposal(
  source: AnalysisDataSource,
  physicalColumns: readonly string[],
  ddl: TuningProjectionDdl,
): ResultAsync<TuningValidation, TuningValidationError> {
  return ResultAsync.fromPromise(
    getClickHouseClient().query({
      query: `
        SELECT
          any(t.engine) AS engine,
          any(t.total_bytes) AS source_bytes,
          groupUniqArray(c.name) AS columns,
          (
            SELECT groupUniqArray(name)
            FROM system.projections
            WHERE database = {database:String}
              AND table = {table:String}
          ) AS projection_names
        FROM system.tables AS t
        LEFT JOIN system.columns AS c
          ON c.database = t.database AND c.table = t.name
        WHERE t.database = {database:String}
          AND t.name = {table:String}
        GROUP BY t.database, t.name
      `,
      query_params: {
        database: source.database,
        table: source.table,
      },
      format: "JSONEachRow",
    }),
    validationError,
  ).andThen((response) =>
    ResultAsync.fromPromise(response.json(), validationError),
  ).andThen((rows) => {
    const parsed = relationRowsSchema.safeParse(rows);

    if (!parsed.success) {
      return errAsync(validationError(parsed.error));
    }

    const row = parsed.data[0];
    const sourceExists = row !== undefined;
    const engine = row?.engine ?? null;
    const sourceBytes = row?.source_bytes ?? null;
    const mergeTreeFamily = engine?.endsWith("MergeTree") === true;
    const columnsExist =
      row !== undefined &&
      physicalColumns.every((column) => row.columns.includes(column));
    const projectionExists =
      row?.projection_names.includes(ddl.projectionName) ?? false;
    const messages = [
      sourceExists
        ? "The exact source table exists"
        : "The exact source table does not exist",
      mergeTreeFamily
        ? "The table belongs to the MergeTree family"
        : "Projection templates require a MergeTree-family table",
      columnsExist
        ? "Every ordered field exists as a physical column"
        : "At least one ordered field is missing",
      projectionExists
        ? "The deterministic projection already exists"
        : "The deterministic projection name is available",
    ];

    return okAsync({
      valid:
        sourceExists &&
        mergeTreeFamily &&
        columnsExist &&
        !projectionExists,
      sourceExists,
      mergeTreeFamily,
      columnsExist,
      projectionExists,
      checkedColumns: [...physicalColumns],
      engine,
      sourceBytes,
      messages,
    });
  });
}
