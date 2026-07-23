import type { Readable } from "node:stream";

import { errAsync, okAsync, ResultAsync } from "neverthrow";
import { z } from "zod";

import { getClickHouseClient } from "@/lib/clickhouse/client";
import { verifyAnalyticalArrow } from "@/lib/wasm/node-verifier";

import type { InspectedRelation } from "./contracts";
import { compatibilityCheckSchema } from "./contracts";
import {
  validateMappingSql,
  type MappingPolicyError,
  type ValidatedMapping,
} from "./mapping-policy";
import {
  compileMeasureAggregation,
  type AnalyticalTableManifest,
} from "./semantic";

const profileRowsSchema = z
  .array(z.record(z.string(), z.unknown()))
  .length(1);

const MAXIMUM_VERIFICATION_BYTES = 512 * 1024;

export type CompatibilityError = {
  readonly type: "compatibility_error";
  readonly message: string;
  readonly cause: unknown;
};

export type CompatibleMapping = {
  readonly mapping: ValidatedMapping;
  readonly manifest: AnalyticalTableManifest;
  readonly compatibility: z.infer<typeof compatibilityCheckSchema>;
  readonly dateFrom: string | null;
  readonly dateTo: string | null;
  readonly rowCount: number;
  readonly validationMs: number;
  readonly arrowBytes: number;
  readonly rustVerified: boolean;
  readonly clickHouseElapsedMs: number | null;
  readonly rowsRead: number | null;
  readonly bytesRead: number | null;
};

export type CompatibilityHooks = {
  readonly onMappingValidated?: () => Promise<void>;
  readonly onProfiled?: () => Promise<void>;
};

function compatibilityError(cause: unknown): CompatibilityError {
  return {
    type: "compatibility_error",
    message:
      cause instanceof Error
        ? cause.message
        : "The mapped dataset could not be validated",
    cause,
  };
}

function mappingError(error: MappingPolicyError): CompatibilityError {
  return {
    type: "compatibility_error",
    message: error.message,
    cause: error,
  };
}

async function collectArrow(stream: Readable): Promise<Uint8Array> {
  const chunks: Buffer[] = [];
  let length = 0;

  for await (const chunk of stream) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    length += bytes.byteLength;

    if (length > MAXIMUM_VERIFICATION_BYTES) {
      stream.destroy();
      throw new Error("The Arrow verification result exceeded its safety budget");
    }

    chunks.push(bytes);
  }

  return Buffer.concat(chunks, length);
}

function summaryInteger(value: string | undefined): number | null {
  const parsed = value === undefined ? Number.NaN : Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

export function validateAnalyticalCompatibility(
  mappingSql: string,
  relation: InspectedRelation,
  manifest: AnalyticalTableManifest,
  hooks: CompatibilityHooks = {},
): ResultAsync<CompatibleMapping, CompatibilityError> {
  const startedAt = performance.now();
  const policy = validateMappingSql(mappingSql, relation, manifest);

  if (policy.isErr()) {
    return errAsync(mappingError(policy.error));
  }

  const mapping = policy.value;
  const profileExpressions = [
    "toUInt64(count()) AS row_count",
    ...(manifest.time === null
      ? []
      : [
          `toString(min(${manifest.time.expression})) AS time_from`,
          `toString(max(${manifest.time.expression})) AS time_to`,
          `toUInt64(countIf(isNull(${manifest.time.expression}))) AS invalid_time_count`,
        ]),
    ...(manifest.identifier === null
      ? []
      : [
          `toUInt64(countIf(isNull(${manifest.identifier.expression}))) AS invalid_identifier_count`,
        ]),
    ...manifest.measures.map(
      (measure, index) =>
        `toUInt64(countIf(isNull(${measure.expression}) OR NOT isFinite(toFloat64(${measure.expression})))) AS invalid_measure_${index}`,
    ),
    ...manifest.dimensions.map(
      (dimension, index) =>
        `toUInt64(countIf(isNull(${dimension.filterExpression}))) AS invalid_dimension_${index}`,
    ),
  ];

  return ResultAsync.fromPromise(
    hooks.onMappingValidated?.() ?? Promise.resolve(),
    compatibilityError,
  ).andThen(() => ResultAsync.fromPromise(
    getClickHouseClient().query({
      query: `
        SELECT
          ${profileExpressions.join(",\n          ")}
        FROM (${mapping.normalizedSql}) AS mapped_source
      `,
      format: "JSONEachRow",
      clickhouse_settings: {
        max_execution_time: 30,
        max_rows_to_read: "100000000",
        max_bytes_to_read: "2147483648",
        max_threads: 4,
        max_memory_usage: "536870912",
        max_result_rows: "1",
        readonly: "1",
      },
    }),
    compatibilityError,
  ))
    .andThen((resultSet) =>
      ResultAsync.fromPromise(resultSet.json<unknown>(), compatibilityError),
    )
    .andThen((rows) => {
      const profile = profileRowsSchema.safeParse(rows);

      if (!profile.success) {
        return errAsync(compatibilityError(profile.error));
      }

      const row = profile.data[0]!;
      const rowCount = Number(row.row_count);
      const invalidTimeCount = Number(row.invalid_time_count ?? 0);
      const invalidIdentifierCount = Number(
        row.invalid_identifier_count ?? 0,
      );
      const measureChecks = manifest.measures.map((measure, index) => {
        const invalid = Number(row[`invalid_measure_${index}`] ?? 0);
        return {
          key: `measure_${measure.key}`,
          label: `${measure.label} values are numeric`,
          passed: invalid === 0,
          detail: `${invalid.toLocaleString()} invalid values`,
        };
      });
      const dimensionChecks = manifest.dimensions.map((dimension, index) => {
        const invalid = Number(row[`invalid_dimension_${index}`] ?? 0);
        return {
          key: `dimension_${dimension.key}`,
          label: `${dimension.label} values are present`,
          passed: invalid === 0,
          detail: `${invalid.toLocaleString()} missing values`,
        };
      });
      const roleChecks = [
        ...(manifest.time === null
          ? []
          : [
              {
                key: "time",
                label: `${manifest.time.label} values are present`,
                passed: invalidTimeCount === 0,
                detail: `${invalidTimeCount.toLocaleString()} missing values`,
              },
            ]),
        ...(manifest.identifier === null
          ? []
          : [
              {
                key: "identifier",
                label: `${manifest.identifier.label} values are present`,
                passed: invalidIdentifierCount === 0,
                detail: `${invalidIdentifierCount.toLocaleString()} missing values`,
              },
            ]),
        ...measureChecks,
        ...dimensionChecks,
      ];
      const checks = compatibilityCheckSchema.parse({
        compatible:
          Number.isSafeInteger(rowCount) &&
          rowCount > 0 &&
          roleChecks.every((check) => check.passed),
        checks: [
          {
            key: "rows",
            label: "Contains analytical rows",
            passed: Number.isSafeInteger(rowCount) && rowCount > 0,
            detail: `${rowCount.toLocaleString()} mapped rows`,
          },
          ...roleChecks,
        ],
      });

      if (!checks.compatible) {
        return errAsync(
          compatibilityError(
            new Error(
              checks.checks
                .filter((check) => !check.passed)
                .map((check) => check.label)
                .join(", "),
            ),
          ),
        );
      }

      const primaryMeasure = manifest.measures[0];
      const verificationProjection =
        manifest.time === null
          ? `
              toString('All rows') AS category,
              ${compileMeasureAggregation(primaryMeasure, primaryMeasure.defaultAggregation)} AS value,
              toUInt64(count()) AS observation_count
            `
          : `
              toDate(toStartOfYear(${manifest.time.expression})) AS period_start,
              toString('All rows') AS series,
              ${compileMeasureAggregation(primaryMeasure, primaryMeasure.defaultAggregation)} AS value,
              toUInt64(count()) AS observation_count
            `;
      const verificationGroup =
        manifest.time === null
          ? "GROUP BY category ORDER BY category"
          : "GROUP BY period_start, series ORDER BY period_start, series";

      return ResultAsync.fromPromise(
        hooks.onProfiled?.() ?? Promise.resolve(),
        compatibilityError,
      ).andThen(() => ResultAsync.fromPromise(
        getClickHouseClient().exec({
          query: `
            SELECT
              ${verificationProjection}
            FROM (${mapping.normalizedSql}) AS mapped_source
            ${verificationGroup}
            FORMAT ArrowStream
          `,
          clickhouse_settings: {
            max_execution_time: 20,
            max_rows_to_read: "100000000",
            max_bytes_to_read: "2147483648",
            max_threads: 4,
            max_result_bytes: "524288",
            max_result_rows: "500",
            max_memory_usage: "536870912",
            output_format_arrow_compression_method: "lz4_frame",
            output_format_arrow_string_as_string: 1,
            readonly: "1",
          },
        }),
        compatibilityError,
      )).andThen((response) =>
        ResultAsync.fromPromise(
          collectArrow(response.stream),
          compatibilityError,
        ).andThen((bytes) => {
          const verification = verifyAnalyticalArrow(bytes, {
            time: manifest.time === null ? null : "period_start",
            measure: "value",
            dimension: manifest.time === null ? "category" : "series",
          });

          if (verification.isErr()) {
            return errAsync(compatibilityError(verification.error.cause));
          }

          const elapsedNs = Number(response.summary?.elapsed_ns);

          return okAsync({
            mapping,
            manifest,
            compatibility: checks,
            dateFrom:
              manifest.time === null ? null : String(row.time_from),
            dateTo: manifest.time === null ? null : String(row.time_to),
            rowCount,
            validationMs: performance.now() - startedAt,
            arrowBytes: bytes.byteLength,
            rustVerified: true,
            clickHouseElapsedMs: Number.isFinite(elapsedNs)
              ? elapsedNs / 1_000_000
              : null,
            rowsRead: summaryInteger(response.summary?.read_rows),
            bytesRead: summaryInteger(response.summary?.read_bytes),
          });
        }),
      );
    });
}
