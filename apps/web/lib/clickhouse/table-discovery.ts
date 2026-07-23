import { err, errAsync, ok, okAsync, ResultAsync, type Result } from "neverthrow";
import { z } from "zod";

import {
  clickHouseIdentifierSchema,
  dataSourceDiscoverySchema,
  type DataSourceDiscovery,
  type DataSourceSummary,
} from "../data-sources/contracts";

import { getClickHouseClient } from "./client";
import { getClickHouseConfig } from "./config";

const discoveryRowsSchema = z.array(
  z.object({
    database: clickHouseIdentifierSchema,
    table: clickHouseIdentifierSchema,
    engine: z.string().trim().min(1).max(160),
    estimated_rows: z.coerce.number().int().nonnegative(),
    estimated_bytes: z.coerce.number().int().nonnegative(),
    modified_at: z.string().nullable(),
    column_name: clickHouseIdentifierSchema,
    column_type: z.string().trim().min(1).max(160),
    column_position: z.coerce.number().int().positive(),
  }),
);

const INTERNAL_TABLES = new Set([
  "lens_schema_migrations",
  "query_arena_performance_history",
]);
const MAXIMUM_DISCOVERED_TABLES = 250;
const MAXIMUM_DISCOVERED_COLUMNS = 5_000;

export type TableDiscoveryError = {
  readonly type: "table_discovery_error";
  readonly message: string;
  readonly status: 403 | 503;
  readonly cause: unknown;
};

function discoveryError(
  cause: unknown,
  message = "ClickHouse table discovery is unavailable",
  status: TableDiscoveryError["status"] = 503,
): TableDiscoveryError {
  return {
    type: "table_discovery_error",
    message,
    status,
    cause,
  };
}

function isReservedDatabase(database: string): boolean {
  const normalized = database.toLowerCase();
  return normalized === "system" || normalized === "information_schema";
}

export function discoveryDatabaseAllowlist(
  configuredDatabase: string,
  configuredAllowlist: string | undefined,
): Result<readonly string[], TableDiscoveryError> {
  const candidates = [
    configuredDatabase,
    ...(configuredAllowlist ?? "")
      .split(",")
      .map((database) => database.trim())
      .filter((database) => database.length > 0),
  ];
  const parsed = z.array(clickHouseIdentifierSchema).safeParse(candidates);

  if (!parsed.success || parsed.data.some(isReservedDatabase)) {
    return err(
      discoveryError(
        parsed.success ? new Error("Reserved database") : parsed.error,
        "The ClickHouse discovery database allowlist is invalid",
      ),
    );
  }

  return ok([...new Set(parsed.data)]);
}

export function isInternalDiscoveryTable(table: string): boolean {
  return (
    INTERNAL_TABLES.has(table.toLowerCase()) ||
    table.startsWith(".inner_id.")
  );
}

function normalizeModifiedAt(value: string | null): string | null {
  if (value === null || value.length === 0) {
    return null;
  }

  const hasTimezone = /(?:Z|[+-]\d{2}:\d{2})$/i.test(value);
  const candidate = `${value.replace(" ", "T")}${hasTimezone ? "" : "Z"}`;
  const milliseconds = Date.parse(candidate);

  if (!Number.isFinite(milliseconds)) {
    throw new Error("ClickHouse returned an invalid modification time");
  }

  return new Date(milliseconds).toISOString();
}

function isDateColumn(type: string): boolean {
  return /(?:^|\()Date(?:32|Time(?:64)?)?\b/.test(type);
}

export function parseTableDiscoveryRows(
  rows: unknown,
  database: string,
): Result<DataSourceDiscovery, TableDiscoveryError> {
  const parsed = discoveryRowsSchema.safeParse(rows);

  if (!parsed.success) {
    return err(discoveryError(parsed.error));
  }

  const grouped = new Map<string, z.infer<typeof discoveryRowsSchema>[number][]>();

  for (const row of parsed.data) {
    if (row.database !== database) {
      return err(
        discoveryError(
          new Error("Cross-database discovery row"),
          "ClickHouse returned data outside the requested database",
        ),
      );
    }

    if (isInternalDiscoveryTable(row.table)) {
      continue;
    }

    const tableRows = grouped.get(row.table) ?? [];
    tableRows.push(row);
    grouped.set(row.table, tableRows);
  }

  if (
    grouped.size > MAXIMUM_DISCOVERED_TABLES ||
    parsed.data.length > MAXIMUM_DISCOVERED_COLUMNS
  ) {
    return err(
      discoveryError(
        new Error("Discovery result exceeded its safety budget"),
        "The ClickHouse schema is too large to discover safely",
      ),
    );
  }

  try {
    const tables = [...grouped.entries()]
      .map(([table, tableRows]) => {
        const first = tableRows[0]!;
        const consistent = tableRows.every(
          (row) =>
            row.engine === first.engine &&
            row.estimated_rows === first.estimated_rows &&
            row.estimated_bytes === first.estimated_bytes &&
            row.modified_at === first.modified_at,
        );

        if (!consistent) {
          throw new Error(`ClickHouse returned inconsistent metadata for ${table}`);
        }

        const columns = tableRows
          .map((row) => ({
            name: row.column_name,
            type: row.column_type,
            position: row.column_position,
          }))
          .sort((left, right) => left.position - right.position);

        return {
          database,
          table,
          engine: first.engine,
          estimatedRows: first.estimated_rows,
          estimatedBytes: first.estimated_bytes,
          columnCount: columns.length,
          modifiedAt: normalizeModifiedAt(first.modified_at),
          dateColumns: columns
            .filter((column) => isDateColumn(column.type))
            .map((column) => column.name),
          columns,
          registered: null,
        };
      })
      .sort(
        (left, right) =>
          right.estimatedRows - left.estimatedRows ||
          left.table.localeCompare(right.table),
      );
    const output = dataSourceDiscoverySchema.safeParse({ database, tables });

    return output.success
      ? ok(output.data)
      : err(discoveryError(output.error));
  } catch (cause) {
    return err(discoveryError(cause));
  }
}

export function attachRegisteredDiscoverySources(
  discovery: DataSourceDiscovery,
  sources: readonly DataSourceSummary[],
): DataSourceDiscovery {
  return dataSourceDiscoverySchema.parse({
    ...discovery,
    tables: discovery.tables.map((table) => {
      const source = sources.find(
        (candidate) =>
          candidate.database === table.database &&
          candidate.table === table.table,
      );

      return {
        ...table,
        registered:
          source === undefined
            ? null
            : { slug: source.slug, version: source.version },
      };
    }),
  });
}

export function discoverClickHouseTables(
  requestedDatabase?: string,
): ResultAsync<DataSourceDiscovery, TableDiscoveryError> {
  let configuredDatabase: string;

  try {
    configuredDatabase = getClickHouseConfig().database;
  } catch (cause) {
    return errAsync(discoveryError(cause));
  }

  const allowlist = discoveryDatabaseAllowlist(
    configuredDatabase,
    process.env.CLICKHOUSE_DISCOVERY_DATABASES,
  );

  if (allowlist.isErr()) {
    return errAsync(allowlist.error);
  }

  const database = requestedDatabase ?? configuredDatabase;

  if (
    !clickHouseIdentifierSchema.safeParse(database).success ||
    !allowlist.value.includes(database)
  ) {
    return errAsync(
      discoveryError(
        new Error("Database is not allowlisted"),
        "That ClickHouse database is not available for discovery",
        403,
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
          toUInt64(coalesce(tables.total_bytes, 0)) AS estimated_bytes,
          toString(tables.metadata_modification_time) AS modified_at,
          columns.name AS column_name,
          columns.type AS column_type,
          columns.position AS column_position
        FROM system.columns AS columns
        INNER JOIN system.tables AS tables
          ON tables.database = columns.database
         AND tables.name = columns.table
        WHERE columns.database = {database: String}
          AND tables.is_temporary = 0
          AND NOT startsWith(tables.name, '.inner_id.')
          AND tables.name NOT IN {internalTables: Array(String)}
        ORDER BY tables.total_rows DESC, columns.table, columns.position
      `,
      query_params: {
        database,
        internalTables: [...INTERNAL_TABLES],
      },
      format: "JSONEachRow",
      clickhouse_settings: {
        max_execution_time: 5,
        max_result_rows: String(MAXIMUM_DISCOVERED_COLUMNS),
        readonly: "1",
      },
    }),
    discoveryError,
  )
    .andThen((resultSet) =>
      ResultAsync.fromPromise(resultSet.json<unknown>(), discoveryError),
    )
    .andThen((rows) => {
      const result = parseTableDiscoveryRows(rows, database);
      return result.isOk() ? okAsync(result.value) : errAsync(result.error);
    });
}
