import { errAsync, okAsync, ResultAsync } from "neverthrow";
import { z } from "zod";

import {
  inspectedRelationSchema,
  type InspectedRelation,
} from "@/lib/data-sources/contracts";

import { getClickHouseClient } from "./client";
import { getClickHouseConfig } from "./config";

const inspectionRowsSchema = z.array(
  z.object({
    database: z.string(),
    table: z.string(),
    engine: z.string(),
    estimated_rows: z.coerce.number().int().nonnegative(),
    column_name: z.string(),
    column_type: z.string(),
    column_position: z.coerce.number().int().positive(),
  }),
);

export type SchemaInspectionError = {
  readonly type: "schema_inspection_error";
  readonly message: string;
  readonly cause: unknown;
};

function inspectionError(cause: unknown): SchemaInspectionError {
  return {
    type: "schema_inspection_error",
    message:
      cause instanceof Error
        ? cause.message
        : "ClickHouse could not inspect that relation",
    cause,
  };
}

export function inspectClickHouseRelation(
  database: string,
  table: string,
): ResultAsync<InspectedRelation, SchemaInspectionError> {
  const configuredDatabase = getClickHouseConfig().database;

  if (
    database !== configuredDatabase ||
    database === "system" ||
    database === "information_schema"
  ) {
    return errAsync(
      inspectionError(
        new Error("Only relations in the configured analytical database may be inspected"),
      ),
    );
  }

  return ResultAsync.fromPromise(
    getClickHouseClient().query({
      query: `
        SELECT
          columns.database AS database,
          columns.table AS table,
          tables.engine AS engine,
          toUInt64(coalesce(tables.total_rows, 0)) AS estimated_rows,
          columns.name AS column_name,
          columns.type AS column_type,
          columns.position AS column_position
        FROM system.columns AS columns
        INNER JOIN system.tables AS tables
          ON tables.database = columns.database
         AND tables.name = columns.table
        WHERE columns.database = {database: String}
          AND columns.table = {table: String}
        ORDER BY columns.position
      `,
      query_params: { database, table },
      format: "JSONEachRow",
      clickhouse_settings: {
        max_execution_time: 5,
        max_result_rows: "500",
        readonly: "1",
      },
    }),
    inspectionError,
  )
    .andThen((resultSet) =>
      ResultAsync.fromPromise(resultSet.json<unknown>(), inspectionError),
    )
    .andThen((rows) => {
      const parsed = inspectionRowsSchema.safeParse(rows);

      if (!parsed.success) {
        return errAsync(inspectionError(parsed.error));
      }

      const first = parsed.data[0];

      if (first === undefined) {
        return errAsync(
          inspectionError(
            new Error("The relation was not found or is not visible to the ClickHouse user"),
          ),
        );
      }

      const relation = inspectedRelationSchema.safeParse({
        database: first.database,
        table: first.table,
        engine: first.engine,
        estimatedRows: first.estimated_rows,
        columns: parsed.data.map((row) => ({
          name: row.column_name,
          type: row.column_type,
          position: row.column_position,
        })),
      });

      return relation.success
        ? okAsync(relation.data)
        : errAsync(inspectionError(relation.error));
    });
}
