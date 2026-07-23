import { createHash, randomUUID } from "node:crypto";

import { errAsync, okAsync, ResultAsync } from "neverthrow";
import { z } from "zod";

import { getPostgresClient } from "@/lib/postgres/client";

import { BUILTIN_DATA_SOURCE, toDataSourceSummary } from "./builtin";
import {
  dataSourceListSchema,
  type AnalysisDataSource,
  type DataSourceSummary,
  type InspectedRelation,
  type RegisterDataSourceInput,
} from "./contracts";
import type { CompatibleMapping } from "./compatibility";
import {
  analyticalTableManifestSchema,
  deriveAnalyticalCapabilities,
} from "./semantic";

const WORKSPACE_KEY = "default";

const sourceRowsSchema = z.array(
  z.object({
    slug: z.string(),
    display_name: z.string(),
    version: z.coerce.number().int().positive(),
    source_database: z.string(),
    source_table: z.string(),
    mapping_sql: z.string(),
    semantic_manifest: analyticalTableManifestSchema,
    date_from: z.string().nullable(),
    date_to: z.string().nullable(),
    row_count: z.coerce.number().int().nonnegative(),
  }),
);

const selectedRowsSchema = z.array(
  z.object({
    slug: z.string(),
    version: z.coerce.number().int().positive(),
  }),
);

export type DataSourceRegistryError = {
  readonly type: "data_source_registry_error";
  readonly message: string;
  readonly cause: unknown;
};

function registryError(cause: unknown): DataSourceRegistryError {
  return {
    type: "data_source_registry_error",
    message:
      cause instanceof Error
        ? cause.message
        : "The dataset registry is unavailable",
    cause,
  };
}

function rowToSource(
  row: z.infer<typeof sourceRowsSchema>[number],
): AnalysisDataSource {
  return {
    slug: row.slug,
    displayName: row.display_name,
    version: row.version,
    contractVersion: "analytical_table/v1",
    database: row.source_database,
    table: row.source_table,
    mappingSql: row.mapping_sql,
    dateFrom: row.date_from,
    dateTo: row.date_to,
    rowCount: row.row_count,
    supportsPrewhere: false,
    queryArenaEligible: true,
    manifest: row.semantic_manifest,
    capabilities: deriveAnalyticalCapabilities(row.semantic_manifest, {
      dateFrom: row.date_from,
      dateTo: row.date_to,
    }),
    builtin: false,
  };
}

function queryRegisteredSources() {
  const sql = getPostgresClient();

  if (sql === null) {
    return okAsync([] as AnalysisDataSource[]);
  }

  return ResultAsync.fromPromise(
    sql`
      SELECT
        sources.slug,
        sources.display_name,
        versions.version,
        versions.source_database,
        versions.source_table,
        versions.mapping_sql,
        versions.semantic_manifest,
        versions.date_from::TEXT AS date_from,
        versions.date_to::TEXT AS date_to,
        versions.row_count
      FROM data_sources AS sources
      INNER JOIN active_data_source_versions AS active
        ON active.data_source_id = sources.id
      INNER JOIN data_source_versions AS versions
        ON versions.data_source_id = active.data_source_id
       AND versions.version = active.version
      WHERE versions.status = 'compatible'
      ORDER BY sources.display_name
    `,
    registryError,
  ).andThen((rows) => {
    const parsed = sourceRowsSchema.safeParse(rows);
    return parsed.success
      ? okAsync(parsed.data.map(rowToSource))
      : errAsync(registryError(parsed.error));
  });
}

function queryRegisteredSourceVersion(
  slug: string,
  version?: number,
): ResultAsync<AnalysisDataSource | null, DataSourceRegistryError> {
  const sql = getPostgresClient();

  if (sql === null) {
    return okAsync(null);
  }

  const query =
    version === undefined
      ? sql`
          SELECT
            sources.slug,
            sources.display_name,
            versions.version,
            versions.source_database,
            versions.source_table,
            versions.mapping_sql,
            versions.semantic_manifest,
            versions.date_from::TEXT AS date_from,
            versions.date_to::TEXT AS date_to,
            versions.row_count
          FROM data_sources AS sources
          INNER JOIN active_data_source_versions AS active
            ON active.data_source_id = sources.id
          INNER JOIN data_source_versions AS versions
            ON versions.data_source_id = active.data_source_id
           AND versions.version = active.version
          WHERE sources.slug = ${slug}
            AND versions.status = 'compatible'
          LIMIT 1
        `
      : sql`
          SELECT
            sources.slug,
            sources.display_name,
            versions.version,
            versions.source_database,
            versions.source_table,
            versions.mapping_sql,
            versions.semantic_manifest,
            versions.date_from::TEXT AS date_from,
            versions.date_to::TEXT AS date_to,
            versions.row_count
          FROM data_sources AS sources
          INNER JOIN data_source_versions AS versions
            ON versions.data_source_id = sources.id
          WHERE sources.slug = ${slug}
            AND versions.version = ${version}
            AND versions.status = 'compatible'
          LIMIT 1
        `;

  return ResultAsync.fromPromise(query, registryError).andThen((rows) => {
    const parsed = sourceRowsSchema.safeParse(rows);
    return parsed.success
      ? okAsync(parsed.data[0] === undefined ? null : rowToSource(parsed.data[0]))
      : errAsync(registryError(parsed.error));
  });
}

export function listDataSources(): ResultAsync<
  z.infer<typeof dataSourceListSchema>,
  DataSourceRegistryError
> {
  const sql = getPostgresClient();

  if (sql === null) {
    return okAsync({
      registryConnected: false,
      selected: BUILTIN_DATA_SOURCE.slug,
      selectedVersion: BUILTIN_DATA_SOURCE.version,
      sources: [toDataSourceSummary(BUILTIN_DATA_SOURCE, true)],
    });
  }

  return queryRegisteredSources().andThen((registered) =>
    ResultAsync.fromPromise(
      sql`
        SELECT sources.slug, selected.version
        FROM workspace_data_source_selections AS selected
        INNER JOIN data_sources AS sources
          ON sources.id = selected.data_source_id
        WHERE selected.workspace_key = ${WORKSPACE_KEY}
        LIMIT 1
      `,
      registryError,
    ).andThen((selectionRows) => {
      const parsed = selectedRowsSchema.safeParse(selectionRows);

      if (!parsed.success) {
        return errAsync(registryError(parsed.error));
      }

      const selectedRow = parsed.data[0];
      const selected = selectedRow?.slug ?? BUILTIN_DATA_SOURCE.slug;
      const selectedVersion =
        selectedRow?.version ?? BUILTIN_DATA_SOURCE.version;

      return queryRegisteredSourceVersion(selected, selectedVersion).andThen(
        (pinnedSource) => {
          const registeredWithPinned =
            pinnedSource !== null &&
            !registered.some(
              (source) =>
                source.slug === pinnedSource.slug &&
                source.version === pinnedSource.version,
            )
              ? [pinnedSource, ...registered]
              : registered;
          const sources: DataSourceSummary[] = [
            toDataSourceSummary(
              BUILTIN_DATA_SOURCE,
              selected === BUILTIN_DATA_SOURCE.slug &&
                selectedVersion === BUILTIN_DATA_SOURCE.version,
            ),
            ...registeredWithPinned.map((source) =>
              toDataSourceSummary(
                source,
                source.slug === selected && source.version === selectedVersion,
              ),
            ),
          ];
          const output = dataSourceListSchema.safeParse({
            registryConnected: true,
            selected,
            selectedVersion,
            sources,
          });

          return output.success
            ? okAsync(output.data)
            : errAsync(registryError(output.error));
        },
      );
    }),
  );
}

export function getAnalysisDataSource(
  slug: string,
  version?: number,
): ResultAsync<AnalysisDataSource, DataSourceRegistryError> {
  if (slug === BUILTIN_DATA_SOURCE.slug) {
    return version === undefined || version === BUILTIN_DATA_SOURCE.version
      ? okAsync(BUILTIN_DATA_SOURCE)
      : errAsync(
          registryError(
            new Error(`Built-in dataset version ${version} does not exist`),
          ),
        );
  }

  if (version === undefined) {
    return errAsync(
      registryError(
        new Error(`Dataset ${slug} requires an immutable version`),
      ),
    );
  }

  return queryRegisteredSourceVersion(slug, version).andThen((source) =>
    source === null
      ? errAsync(registryError(new Error(`Dataset ${slug} is not registered`)))
      : okAsync(source),
  );
}

export function getSelectedDataSource(): ResultAsync<
  AnalysisDataSource,
  DataSourceRegistryError
> {
  return listDataSources().andThen((registry) =>
    getAnalysisDataSource(registry.selected, registry.selectedVersion),
  );
}

export function selectDataSource(
  slug: string,
): ResultAsync<DataSourceSummary, DataSourceRegistryError> {
  const sql = getPostgresClient();

  if (slug === BUILTIN_DATA_SOURCE.slug) {
    if (sql === null) {
      return okAsync(toDataSourceSummary(BUILTIN_DATA_SOURCE, true));
    }

    return ResultAsync.fromPromise(
      sql`
        DELETE FROM workspace_data_source_selections
        WHERE workspace_key = ${WORKSPACE_KEY}
      `,
      registryError,
    ).map(() => toDataSourceSummary(BUILTIN_DATA_SOURCE, true));
  }

  if (sql === null) {
    return errAsync(
      registryError(new Error("PostgreSQL is required to select a registered dataset")),
    );
  }

  return queryRegisteredSourceVersion(slug).andThen((source) => {
    if (source === null) {
      return errAsync(
        registryError(new Error(`Dataset ${slug} is not registered`)),
      );
    }

    return (
    ResultAsync.fromPromise(
      sql`
        INSERT INTO workspace_data_source_selections
          (workspace_key, data_source_id, version, selected_at)
        SELECT ${WORKSPACE_KEY}, sources.id, active.version, NOW()
        FROM data_sources AS sources
        INNER JOIN active_data_source_versions AS active
          ON active.data_source_id = sources.id
        WHERE sources.slug = ${slug}
        ON CONFLICT (workspace_key)
        DO UPDATE SET
          data_source_id = EXCLUDED.data_source_id,
          version = EXCLUDED.version,
          selected_at = NOW()
      `,
      registryError,
    ).map(() => toDataSourceSummary(source, true))
    );
  });
}

export function deleteRegisteredDataSource(
  slug: string,
): ResultAsync<DataSourceSummary, DataSourceRegistryError> {
  if (slug === BUILTIN_DATA_SOURCE.slug) {
    return errAsync(
      registryError(new Error("The built-in dataset cannot be deleted")),
    );
  }

  const sql = getPostgresClient();

  if (sql === null) {
    return errAsync(
      registryError(new Error("PostgreSQL is required to delete a dataset")),
    );
  }

  return queryRegisteredSourceVersion(slug).andThen((source) => {
    if (source === null) {
      return errAsync(
        registryError(new Error(`Dataset ${slug} is not registered`)),
      );
    }

    return ResultAsync.fromPromise(
      sql.begin(async (transaction) => {
        await transaction`
          SELECT pg_advisory_xact_lock(hashtext(${slug}))
        `;

        const rows = await transaction<{ id: string }[]>`
          SELECT id
          FROM data_sources
          WHERE slug = ${slug}
          FOR UPDATE
        `;
        const dataSourceId = rows[0]?.id;

        if (dataSourceId === undefined) {
          throw new Error(`Dataset ${slug} is not registered`);
        }

        await transaction`
          DELETE FROM workspace_data_source_selections
          WHERE data_source_id = ${dataSourceId}
        `;
        await transaction`
          DELETE FROM data_source_performance_profiles
          WHERE data_source_id = ${dataSourceId}
        `;
        await transaction`
          DELETE FROM active_data_source_versions
          WHERE data_source_id = ${dataSourceId}
        `;
        await transaction`
          DELETE FROM data_source_versions
          WHERE data_source_id = ${dataSourceId}
        `;
        await transaction`
          DELETE FROM data_sources
          WHERE id = ${dataSourceId}
        `;
      }),
      registryError,
    ).map(() => toDataSourceSummary(source, false));
  });
}

export function registerCompatibleDataSource(
  input: RegisterDataSourceInput,
  relation: InspectedRelation,
  validation: CompatibleMapping,
): ResultAsync<DataSourceSummary, DataSourceRegistryError> {
  const sql = getPostgresClient();

  if (sql === null) {
    return errAsync(
      registryError(new Error("PostgreSQL is required to register a dataset")),
    );
  }

  const mappingDigest = createHash("sha256")
    .update(
      `${validation.mapping.digestInput}\n${JSON.stringify(validation.manifest)}`,
    )
    .digest("hex");

  return ResultAsync.fromPromise(
    sql.begin(async (transaction) => {
      await transaction`
        SELECT pg_advisory_xact_lock(hashtext(${input.slug}))
      `;

      const existing = await transaction<{ id: string }[]>`
        SELECT id FROM data_sources WHERE slug = ${input.slug}
      `;
      const dataSourceId = existing[0]?.id ?? randomUUID();

      await transaction`
        INSERT INTO data_sources (id, slug, display_name)
        VALUES (${dataSourceId}, ${input.slug}, ${input.displayName})
        ON CONFLICT (slug)
        DO UPDATE SET display_name = EXCLUDED.display_name, updated_at = NOW()
      `;

      const matchingVersions = await transaction<{ version: number }[]>`
        SELECT version
        FROM data_source_versions
        WHERE data_source_id = ${dataSourceId}
          AND mapping_digest = ${mappingDigest}
          AND status = 'compatible'
      `;
      let version = Number(matchingVersions[0]?.version ?? 0);

      if (version === 0) {
        const versions = await transaction<{ next_version: number }[]>`
          SELECT COALESCE(MAX(version), 0) + 1 AS next_version
          FROM data_source_versions
          WHERE data_source_id = ${dataSourceId}
        `;
        version = Number(versions[0]?.next_version ?? 1);

        await transaction`
          INSERT INTO data_source_versions
            (data_source_id, version, contract_version, source_database,
             source_table, mapping_sql, mapping_digest, source_schema,
             semantic_manifest,
             compatibility_report, status, date_from, date_to, row_count)
          VALUES
            (${dataSourceId}, ${version}, 'analytical_table/v1',
             ${input.database}, ${input.table}, ${validation.mapping.normalizedSql},
             ${mappingDigest}, ${transaction.json(relation)},
             ${transaction.json(validation.manifest)},
             ${transaction.json(validation.compatibility)}, 'compatible',
             ${validation.dateFrom}, ${validation.dateTo}, ${validation.rowCount})
        `;
      }

      await transaction`
        INSERT INTO active_data_source_versions
          (data_source_id, version, activated_at)
        VALUES (${dataSourceId}, ${version}, NOW())
        ON CONFLICT (data_source_id)
        DO UPDATE SET version = EXCLUDED.version, activated_at = NOW()
      `;

      await transaction`
        INSERT INTO data_source_performance_profiles
          (data_source_id, version, validation_ms, clickhouse_elapsed_ms,
           rows_read, bytes_read, arrow_bytes, rust_verified)
        VALUES
          (${dataSourceId}, ${version}, ${validation.validationMs},
           ${validation.clickHouseElapsedMs}, ${validation.rowsRead},
           ${validation.bytesRead}, ${validation.arrowBytes},
           ${validation.rustVerified})
        ON CONFLICT (data_source_id, version)
        DO UPDATE SET
          validation_ms = EXCLUDED.validation_ms,
          clickhouse_elapsed_ms = EXCLUDED.clickhouse_elapsed_ms,
          rows_read = EXCLUDED.rows_read,
          bytes_read = EXCLUDED.bytes_read,
          arrow_bytes = EXCLUDED.arrow_bytes,
          rust_verified = EXCLUDED.rust_verified,
          recorded_at = NOW()
      `;

      return version;
    }),
    registryError,
  ).map((version) =>
    toDataSourceSummary(
      {
        slug: input.slug,
        displayName: input.displayName,
        version,
        contractVersion: "analytical_table/v1",
        database: input.database,
        table: input.table,
        mappingSql: validation.mapping.normalizedSql,
        dateFrom: validation.dateFrom,
        dateTo: validation.dateTo,
        rowCount: validation.rowCount,
        supportsPrewhere: false,
        queryArenaEligible: true,
        manifest: validation.manifest,
        capabilities: deriveAnalyticalCapabilities(validation.manifest, {
          dateFrom: validation.dateFrom,
          dateTo: validation.dateTo,
        }),
        builtin: false,
      },
      false,
    ),
  );
}
