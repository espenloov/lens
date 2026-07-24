import { z } from "zod";

export const semanticKeySchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/);

export const aggregationSchema = z.enum([
  "average",
  "median",
  "sum",
  "minimum",
  "maximum",
]);

const numberFormatSchema = z.object({
  kind: z.literal("number"),
  maximumFractionDigits: z.number().int().min(0).max(8).default(2),
});

const currencyFormatSchema = z.object({
  kind: z.literal("currency"),
  currency: z.string().regex(/^[A-Z]{3}$/),
  maximumFractionDigits: z.number().int().min(0).max(8).default(0),
});

const percentFormatSchema = z.object({
  kind: z.literal("percent"),
  maximumFractionDigits: z.number().int().min(0).max(8).default(1),
});

const durationFormatSchema = z.object({
  kind: z.literal("duration"),
  unit: z.enum(["milliseconds", "seconds"]),
  maximumFractionDigits: z.number().int().min(0).max(8).default(2),
});

export const analyticalFormatSchema = z.discriminatedUnion("kind", [
  numberFormatSchema,
  currencyFormatSchema,
  percentFormatSchema,
  durationFormatSchema,
]);

export const analyticalMeasureSchema = z
  .object({
    key: semanticKeySchema,
    label: z.string().trim().min(1).max(80),
    expression: z.string().trim().min(1).max(1_000),
    defaultAggregation: aggregationSchema,
    aggregations: z.array(aggregationSchema).min(1).max(5),
    format: analyticalFormatSchema,
    resultScale: z.number().int().min(0).max(8).nullable().default(null),
    supportsDistribution: z.boolean().default(false),
  })
  .superRefine((measure, context) => {
    if (!measure.aggregations.includes(measure.defaultAggregation)) {
      context.addIssue({
        code: "custom",
        message: "The default aggregation must be included in aggregations",
        path: ["defaultAggregation"],
      });
    }

    if (new Set(measure.aggregations).size !== measure.aggregations.length) {
      context.addIssue({
        code: "custom",
        message: "Measure aggregations must be unique",
        path: ["aggregations"],
      });
    }
  });

export const analyticalDimensionValueSchema = z.object({
  value: z.union([z.string(), z.number(), z.boolean()]),
  label: z.string().trim().min(1).max(80),
  order: z.number().int(),
  code: z.number().int().min(0).max(255).optional(),
});

export const analyticalDimensionSchema = z.object({
  key: semanticKeySchema,
  label: z.string().trim().min(1).max(80),
  expression: z.string().trim().min(1).max(1_000),
  filterExpression: z.string().trim().min(1).max(1_000),
  orderExpression: z.string().trim().min(1).max(1_000).nullable().default(null),
  codeExpression: z.string().trim().min(1).max(1_000).nullable().default(null),
  kind: z.enum(["categorical", "ordinal", "boolean"]),
  compact: z.boolean().default(false),
  geographyLevel: z.number().int().min(0).max(8).nullable().default(null),
  values: z.array(analyticalDimensionValueSchema).max(256).default([]),
});

export const analyticalTimeSchema = z.object({
  key: semanticKeySchema,
  label: z.string().trim().min(1).max(80),
  expression: z.string().trim().min(1).max(1_000),
  storageType: z.enum(["date", "datetime"]),
  granularities: z
    .array(z.enum(["year", "quarter", "month"]))
    .min(1)
    .max(3)
    .refine((values) => new Set(values).size === values.length, {
      message: "Time granularities must be unique",
    }),
  timezone: z.string().trim().min(1).max(80).nullable().default(null),
});

export const analyticalIdentifierSchema = z.object({
  key: semanticKeySchema,
  label: z.string().trim().min(1).max(80),
  expression: z.string().trim().min(1).max(1_000),
});

export const analyticalGeographySchema = z.object({
  levels: z.array(semanticKeySchema).min(1).max(8),
});

export const analyticalTableManifestSchema = z
  .object({
    contract: z.literal("analytical_table/v1"),
    identifier: analyticalIdentifierSchema.nullable(),
    time: analyticalTimeSchema.nullable(),
    measures: z.array(analyticalMeasureSchema).max(32),
    dimensions: z.array(analyticalDimensionSchema).max(64),
    geography: analyticalGeographySchema.nullable(),
  })
  .superRefine((manifest, context) => {
    const allKeys = [
      ...(manifest.identifier === null ? [] : [manifest.identifier.key]),
      ...(manifest.time === null ? [] : [manifest.time.key]),
      ...manifest.measures.map((measure) => measure.key),
      ...manifest.dimensions.map((dimension) => dimension.key),
    ];

    if (new Set(allKeys).size !== allKeys.length) {
      context.addIssue({
        code: "custom",
        message: "Manifest semantic keys must be unique",
        path: [],
      });
    }

    const dimensions = new Map(
      manifest.dimensions.map((dimension) => [dimension.key, dimension]),
    );

    if (manifest.geography !== null) {
      if (
        new Set(manifest.geography.levels).size !==
        manifest.geography.levels.length
      ) {
        context.addIssue({
          code: "custom",
          message: "Geography levels must be unique",
          path: ["geography", "levels"],
        });
      }

      manifest.geography.levels.forEach((key, index) => {
        const dimension = dimensions.get(key);

        if (dimension === undefined) {
          context.addIssue({
            code: "custom",
            message: `Geography references unknown dimension ${key}`,
            path: ["geography", "levels", index],
          });
        } else if (dimension.geographyLevel !== index) {
          context.addIssue({
            code: "custom",
            message: `Geography dimension ${key} must declare level ${index}`,
            path: ["dimensions"],
          });
        }
      });
    }

    manifest.dimensions.forEach((dimension, index) => {
      const valueKeys = dimension.values.map(
        ({ value }) => `${typeof value}:${String(value)}`,
      );
      const orders = dimension.values.map(({ order }) => order);
      const codes = dimension.values.flatMap(({ code }) =>
        code === undefined ? [] : [code],
      );

      if (new Set(valueKeys).size !== valueKeys.length) {
        context.addIssue({
          code: "custom",
          message: "Dimension values must be unique",
          path: ["dimensions", index, "values"],
        });
      }

      if (new Set(orders).size !== orders.length) {
        context.addIssue({
          code: "custom",
          message: "Dimension value order must be unique",
          path: ["dimensions", index, "values"],
        });
      }

      if (dimension.compact && dimension.codeExpression === null) {
        context.addIssue({
          code: "custom",
          message: "Compact dimensions require a code expression",
          path: ["dimensions", index, "codeExpression"],
        });
      }

      if (dimension.compact && dimension.values.length === 0) {
        context.addIssue({
          code: "custom",
          message: "Compact dimensions require a value codebook",
          path: ["dimensions", index, "values"],
        });
      }

      if (dimension.compact && codes.length !== dimension.values.length) {
        context.addIssue({
          code: "custom",
          message: "Every compact dimension value requires a code",
          path: ["dimensions", index, "values"],
        });
      }

      if (dimension.compact && new Set(codes).size !== codes.length) {
        context.addIssue({
          code: "custom",
          message: "Compact dimension codes must be unique",
          path: ["dimensions", index, "values"],
        });
      }

      if (
        dimension.geographyLevel !== null &&
        !manifest.geography?.levels.includes(dimension.key)
      ) {
        context.addIssue({
          code: "custom",
          message: "Geography dimensions must appear in geography levels",
          path: ["dimensions", index, "geographyLevel"],
        });
      }
    });
  });

export const analyticalCapabilitiesSchema = z.object({
  operations: z.object({
    trend: z.boolean(),
    comparison: z.boolean(),
    ranking: z.boolean(),
    distribution: z.boolean(),
    composition: z.boolean(),
    heatmap: z.boolean(),
    anomaly: z.boolean(),
    exploration: z.boolean(),
  }),
  measureKeys: z.array(semanticKeySchema),
  dimensionKeys: z.array(semanticKeySchema),
  compactDimensionKeys: z.array(semanticKeySchema),
  geographyKeys: z.array(semanticKeySchema),
  timeGranularities: z.array(z.enum(["year", "quarter", "month"])),
});

export type Aggregation = z.infer<typeof aggregationSchema>;
export type AnalyticalMeasure = z.infer<typeof analyticalMeasureSchema>;
export type AnalyticalDimension = z.infer<typeof analyticalDimensionSchema>;
export type AnalyticalTableManifest = z.infer<
  typeof analyticalTableManifestSchema
>;
export type AnalyticalCapabilities = z.infer<
  typeof analyticalCapabilitiesSchema
>;

type AnalyticalCoverage = {
  readonly dateFrom: string | null;
  readonly dateTo: string | null;
};

function hasFiveYearsOfCoverage(coverage: AnalyticalCoverage): boolean {
  if (coverage.dateFrom === null || coverage.dateTo === null) {
    return false;
  }

  const from = new Date(`${coverage.dateFrom}T00:00:00.000Z`);
  const to = new Date(`${coverage.dateTo}T00:00:00.000Z`);

  if (Number.isNaN(from.valueOf()) || Number.isNaN(to.valueOf())) {
    return false;
  }

  const fiveYearsLater = new Date(from);
  fiveYearsLater.setUTCFullYear(fiveYearsLater.getUTCFullYear() + 5);

  return to >= fiveYearsLater;
}

export function deriveAnalyticalCapabilities(
  manifest: AnalyticalTableManifest,
  coverage?: AnalyticalCoverage,
): AnalyticalCapabilities {
  const hasTime = manifest.time !== null;
  const hasDimension = manifest.dimensions.length > 0;
  const compactDimensions = manifest.dimensions.filter(
    (dimension) => dimension.compact && dimension.codeExpression !== null,
  );
  const distributionMeasures = manifest.measures.filter(
    (measure) => measure.supportsDistribution,
  );

  return analyticalCapabilitiesSchema.parse({
    operations: {
      trend: hasTime,
      comparison: hasDimension,
      ranking: hasDimension,
      distribution: distributionMeasures.length > 0,
      composition: hasDimension,
      heatmap: false,
      anomaly:
        hasTime &&
        (coverage === undefined || hasFiveYearsOfCoverage(coverage)),
      exploration: false,
    },
    measureKeys: manifest.measures.map((measure) => measure.key),
    dimensionKeys: manifest.dimensions.map((dimension) => dimension.key),
    compactDimensionKeys: compactDimensions.map((dimension) => dimension.key),
    geographyKeys: manifest.geography?.levels ?? [],
    timeGranularities: manifest.time?.granularities ?? [],
  });
}

export function findAnalyticalMeasure(
  manifest: AnalyticalTableManifest,
  key: string,
): AnalyticalMeasure | null {
  return manifest.measures.find((measure) => measure.key === key) ?? null;
}

export function findAnalyticalDimension(
  manifest: AnalyticalTableManifest,
  key: string,
): AnalyticalDimension | null {
  return manifest.dimensions.find((dimension) => dimension.key === key) ?? null;
}

export function compileMeasureAggregation(
  measure: AnalyticalMeasure,
  aggregation: Aggregation,
): string {
  if (!measure.aggregations.includes(aggregation)) {
    throw new Error(
      `Measure ${measure.key} does not support aggregation ${aggregation}`,
    );
  }

  const aggregated = (() => {
    switch (aggregation) {
      case "average":
        return `avg(${measure.expression})`;
      case "median":
        return `quantileTDigest(0.5)(${measure.expression})`;
      case "sum":
        return `sum(${measure.expression})`;
      case "minimum":
        return `min(${measure.expression})`;
      case "maximum":
        return `max(${measure.expression})`;
    }
  })();
  const scaled =
    measure.resultScale === null
      ? aggregated
      : `round(${aggregated}, ${measure.resultScale})`;

  return `toFloat64(${scaled})`;
}
