import { z } from "zod";

import {
  analyticalCapabilitiesSchema,
  analyticalTableManifestSchema,
  type AnalyticalCapabilities,
  type AnalyticalTableManifest,
} from "./semantic";

export const datasetSlugSchema = z
  .string()
  .trim()
  .min(3)
  .max(48)
  .regex(/^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/);

export const clickHouseIdentifierSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z_][A-Za-z0-9_]*$/);

export const canonicalColumnSchema = z.enum([
  "date",
  "price",
  "town",
  "district",
  "county",
  "type",
  "duration",
  "is_new",
]);

export const dataSourceStatusSchema = z.enum([
  "pending",
  "compatible",
  "incompatible",
]);

export const sourceColumnSchema = z.object({
  name: clickHouseIdentifierSchema,
  type: z.string().min(1).max(160),
  position: z.number().int().positive(),
});

export const inspectedRelationSchema = z.object({
  database: clickHouseIdentifierSchema,
  table: clickHouseIdentifierSchema,
  engine: z.string().min(1).max(160),
  estimatedRows: z.number().int().nonnegative(),
  columns: z.array(sourceColumnSchema).min(1).max(500),
});

export const inspectDataSourceSchema = z.object({
  database: clickHouseIdentifierSchema,
  table: clickHouseIdentifierSchema,
});

export const discoverDataSourcesSchema = z.object({
  database: clickHouseIdentifierSchema.optional(),
});

export const discoveredTableSchema = z
  .object({
    database: clickHouseIdentifierSchema,
    table: clickHouseIdentifierSchema,
    engine: z.string().trim().min(1).max(160),
    estimatedRows: z.number().int().nonnegative(),
    estimatedBytes: z.number().int().nonnegative(),
    columnCount: z.number().int().positive().max(500),
    modifiedAt: z.iso.datetime().nullable(),
    dateColumns: z.array(clickHouseIdentifierSchema).max(32),
    columns: z.array(sourceColumnSchema).min(1).max(500),
    registered: z
      .object({
        slug: datasetSlugSchema,
        version: z.number().int().positive(),
      })
      .nullable(),
  })
  .superRefine((table, context) => {
    const names = table.columns.map((column) => column.name);
    const positions = table.columns.map((column) => column.position);

    if (new Set(names).size !== names.length) {
      context.addIssue({
        code: "custom",
        message: "Discovered column names must be unique",
        path: ["columns"],
      });
    }

    if (new Set(positions).size !== positions.length) {
      context.addIssue({
        code: "custom",
        message: "Discovered column positions must be unique",
        path: ["columns"],
      });
    }

    if (table.columnCount !== table.columns.length) {
      context.addIssue({
        code: "custom",
        message: "The column count must match the schema summary",
        path: ["columnCount"],
      });
    }
  });

export const dataSourceDiscoverySchema = z.object({
  database: clickHouseIdentifierSchema,
  tables: z.array(discoveredTableSchema).max(250),
});

export const registerDataSourceSchema = z.object({
  slug: datasetSlugSchema.refine((slug) => slug !== "uk_price_paid", {
    message: "uk_price_paid is reserved for the built-in dataset",
  }),
  displayName: z
    .string()
    .trim()
    .min(3)
    .max(80)
    .regex(/^[^\u0000-\u001F\u007F]+$/),
  database: clickHouseIdentifierSchema,
  table: clickHouseIdentifierSchema,
  mappingSql: z.string().trim().min(20).max(20_000),
  manifest: analyticalTableManifestSchema.optional(),
});

export const compatibilityCheckSchema = z.object({
  compatible: z.boolean(),
  checks: z.array(
    z.object({
      key: z.string().min(1).max(80),
      label: z.string().min(1).max(160),
      passed: z.boolean(),
      detail: z.string().min(1).max(320),
    }),
  ),
});

export const dataSourceSummarySchema = z.object({
  slug: datasetSlugSchema,
  displayName: z.string().min(1).max(80),
  version: z.number().int().positive(),
  contractVersion: z.literal("analytical_table/v1"),
  status: dataSourceStatusSchema,
  database: clickHouseIdentifierSchema,
  table: clickHouseIdentifierSchema,
  dateFrom: z.iso.date().nullable(),
  dateTo: z.iso.date().nullable(),
  rowCount: z.number().int().nonnegative(),
  supportsPrewhere: z.boolean(),
  queryArenaEligible: z.boolean(),
  capabilities: analyticalCapabilitiesSchema,
  selected: z.boolean(),
  builtin: z.boolean(),
});

export const dataSourceListSchema = z.object({
  registryConnected: z.boolean(),
  selected: datasetSlugSchema,
  selectedVersion: z.number().int().positive(),
  sources: z.array(dataSourceSummarySchema).min(1),
});

export const registrationResultSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("compatible"),
    source: dataSourceSummarySchema,
    compatibility: compatibilityCheckSchema,
    validationMs: z.number().nonnegative(),
    rustVerified: z.boolean(),
  }),
  z.object({
    status: z.literal("incompatible"),
    compatibility: compatibilityCheckSchema,
    message: z.string().min(1).max(320),
  }),
]);

export const registrationPhaseSchema = z.enum([
  "queued",
  "inspecting",
  "generating_manifest",
  "validating_mapping",
  "profiling",
  "verifying_arrow",
  "registering",
  "completed",
  "failed",
]);

export const registrationMetadataSchema = z.object({
  phase: registrationPhaseSchema,
  progress: z.number().min(0).max(1),
});

export const registrationStartResponseSchema = z.object({
  runId: z.string().min(1),
});

export const registrationSnapshotSchema = z.object({
  status: z.enum(["queued", "running", "completed", "failed"]),
  metadata: registrationMetadataSchema.nullable(),
  result: registrationResultSchema.nullable(),
  error: z.string().nullable(),
});

export type CanonicalColumn = z.infer<typeof canonicalColumnSchema>;
export type InspectedRelation = z.infer<typeof inspectedRelationSchema>;
export type DiscoveredTable = z.infer<typeof discoveredTableSchema>;
export type DataSourceDiscovery = z.infer<typeof dataSourceDiscoverySchema>;
export type RegisterDataSourceInput = z.infer<typeof registerDataSourceSchema>;
export type DataSourceSummary = z.infer<typeof dataSourceSummarySchema>;
export type RegistrationResult = z.infer<typeof registrationResultSchema>;
export type RegistrationSnapshot = z.infer<typeof registrationSnapshotSchema>;

export type DataSourceProfile = {
  readonly time: {
    readonly key: string;
    readonly label: string;
    readonly storageType: "date" | "datetime";
    readonly granularities: readonly ("year" | "quarter" | "month")[];
  } | null;
  readonly measures: readonly {
    readonly key: string;
    readonly label: string;
    readonly aggregations: readonly string[];
    readonly format: string;
  }[];
  readonly dimensions: readonly {
    readonly key: string;
    readonly label: string;
    readonly kind: "categorical" | "ordinal" | "boolean";
    readonly knownValues: number;
  }[];
};

export type AnalysisDataSource = {
  readonly slug: string;
  readonly displayName: string;
  readonly version: number;
  readonly contractVersion: "analytical_table/v1";
  readonly database: string;
  readonly table: string;
  readonly mappingSql: string | null;
  readonly dateFrom: string | null;
  readonly dateTo: string | null;
  readonly rowCount: number;
  readonly supportsPrewhere: boolean;
  readonly queryArenaEligible: boolean;
  readonly manifest: AnalyticalTableManifest;
  readonly capabilities: AnalyticalCapabilities;
  readonly builtin: boolean;
};
