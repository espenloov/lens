import { createHash } from "node:crypto";

import { err, ok, type Result } from "neverthrow";

import type { AnalysisDataSource } from "../../data-sources/contracts";
import { findAnalyticalDimension } from "../../data-sources/semantic";

import type {
  TuningProjectionDdl,
  TuningTemplate,
} from "./contracts";

const PHYSICAL_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

export type ProjectionTemplateError = {
  readonly type: "projection_template_error";
  readonly message: string;
};

export type CompiledProjection = {
  readonly physicalColumns: readonly string[];
  readonly ddl: TuningProjectionDdl;
};

function templateError(message: string): ProjectionTemplateError {
  return { type: "projection_template_error", message };
}

function quoteIdentifier(identifier: string): string {
  return `\`${identifier}\``;
}

function physicalColumn(
  expression: string,
  semanticKey: string,
): Result<string, ProjectionTemplateError> {
  const normalized = expression.trim();

  return PHYSICAL_IDENTIFIER.test(normalized)
    ? ok(normalized)
    : err(
        templateError(
          `Semantic field ${semanticKey} is not backed by one physical column`,
        ),
      );
}

export function compileProjectionTemplate(
  source: AnalysisDataSource,
  template: TuningTemplate,
): Result<CompiledProjection, ProjectionTemplateError> {
  if (source.manifest.time === null) {
    return err(templateError("The dataset does not declare a time field"));
  }

  if (source.manifest.time.key !== template.timeKey) {
    return err(
      templateError(`Unknown time field ${template.timeKey}`),
    );
  }

  const timeColumn = physicalColumn(
    source.manifest.time.expression,
    template.timeKey,
  );

  if (timeColumn.isErr()) {
    return err(timeColumn.error);
  }

  const dimensions: string[] = [];

  for (const key of template.dimensionKeys) {
    const dimension = findAnalyticalDimension(source.manifest, key);

    if (dimension === null) {
      return err(templateError(`Unknown dimension ${key}`));
    }

    const column = physicalColumn(dimension.filterExpression, key);

    if (column.isErr()) {
      return err(column.error);
    }

    dimensions.push(column.value);
  }

  const physicalColumns = [timeColumn.value, ...dimensions];
  const digest = createHash("sha256")
    .update(
      JSON.stringify({
        contract: "lens/ordered_projection_v1",
        dataset: source.slug,
        datasetVersion: source.version,
        database: source.database,
        table: source.table,
        physicalColumns,
      }),
    )
    .digest("hex");
  const projectionName = `lens_ordered_${digest.slice(0, 16)}`;
  const table = `${quoteIdentifier(source.database)}.${quoteIdentifier(source.table)}`;
  const orderBy = physicalColumns.map(quoteIdentifier).join(", ");
  const ddl: TuningProjectionDdl = {
    projectionName,
    add: `ALTER TABLE ${table} ADD PROJECTION IF NOT EXISTS ${quoteIdentifier(projectionName)} (SELECT * ORDER BY (${orderBy}))`,
    materialize: `ALTER TABLE ${table} MATERIALIZE PROJECTION ${quoteIdentifier(projectionName)}`,
    rollback: `ALTER TABLE ${table} DROP PROJECTION IF EXISTS ${quoteIdentifier(projectionName)}`,
    digest,
  };

  return ok({ physicalColumns, ddl });
}
