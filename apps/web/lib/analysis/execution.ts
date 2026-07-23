import { z } from "zod";

import { datasetSlugSchema } from "../data-sources/contracts";

import {
  aggregateMetricSchema,
  categoricalDimensionSchema,
  compactDimensionSchema,
  locationLevelSchema,
  propertyTypeSchema,
  tenureSchema,
  timeIntervalSchema,
} from "./contracts";

const executableFiltersSchema = z
  .object({
    dateFrom: z.iso.date(),
    dateTo: z.iso.date(),
    location: z
      .object({
        level: locationLevelSchema,
        values: z.array(z.string().trim().min(1).max(80)).min(1).max(10),
      })
      .nullable(),
    propertyTypes: z.array(propertyTypeSchema).max(5),
    newBuild: z.boolean().nullable(),
    tenure: z.array(tenureSchema).max(3),
    minimumPrice: z.number().int().min(1).max(100_000_000).nullable(),
    maximumPrice: z.number().int().min(1).max(100_000_000).nullable(),
  })
  .refine((filters) => filters.dateFrom <= filters.dateTo, {
    message: "The start date must be before the end date",
    path: ["dateTo"],
  })
  .refine(
    (filters) =>
      filters.minimumPrice === null ||
      filters.maximumPrice === null ||
      filters.minimumPrice <= filters.maximumPrice,
    {
      message: "The minimum price must not exceed the maximum price",
      path: ["maximumPrice"],
    },
  );

const timeSeriesBase = {
  shape: z.literal("time_series"),
  dataset: datasetSlugSchema.default("uk_price_paid"),
  datasetVersion: z.number().int().positive().optional(),
  filters: executableFiltersSchema,
};

const trendRequestSchema = z.object({
  ...timeSeriesBase,
  operation: z.literal("trend"),
  metric: aggregateMetricSchema,
  interval: timeIntervalSchema,
  seriesBy: categoricalDimensionSchema.nullable(),
  transform: z.enum(["value", "period_change_percent"]),
  anomalyThreshold: z.null(),
});

const timeComparisonRequestSchema = z.object({
  ...timeSeriesBase,
  operation: z.literal("comparison"),
  metric: aggregateMetricSchema,
  interval: timeIntervalSchema,
  seriesBy: categoricalDimensionSchema,
  transform: z.literal("value"),
  anomalyThreshold: z.null(),
});

const timeCompositionRequestSchema = z.object({
  ...timeSeriesBase,
  operation: z.literal("composition"),
  metric: z.literal("transaction_count"),
  interval: timeIntervalSchema,
  seriesBy: compactDimensionSchema,
  transform: z.literal("share"),
  anomalyThreshold: z.null(),
});

const anomalyRequestSchema = z.object({
  ...timeSeriesBase,
  operation: z.literal("anomaly"),
  metric: aggregateMetricSchema,
  interval: z.enum(["year", "month"]),
  seriesBy: categoricalDimensionSchema.nullable(),
  transform: z.literal("anomaly_score"),
  anomalyThreshold: z.union([z.literal(2.5), z.literal(3.5)]),
});

const timeSeriesRequestUnion = z.discriminatedUnion("operation", [
  trendRequestSchema,
  timeComparisonRequestSchema,
  timeCompositionRequestSchema,
  anomalyRequestSchema,
]);

function hasBoundedGeography(
  dimension: z.infer<typeof categoricalDimensionSchema> | null,
  filters: z.infer<typeof executableFiltersSchema>,
) {
  if (
    dimension !== "town" &&
    dimension !== "district" &&
    dimension !== "county"
  ) {
    return true;
  }

  return (
    filters.location !== null &&
    filters.location.level === dimension &&
    filters.location.values.length <= 5
  );
}

const timeSeriesRequestSchema = timeSeriesRequestUnion.superRefine(
  (request, context) => {
    if (request.dataset !== "uk_price_paid" && request.datasetVersion === undefined) {
      context.addIssue({
        code: "custom",
        message: "Registered datasets require an immutable version",
        path: ["datasetVersion"],
      });
    }

    if (!hasBoundedGeography(request.seriesBy, request.filters)) {
      context.addIssue({
        code: "custom",
        message:
          "Geographical series require one to five explicit locations at the same level",
        path: ["seriesBy"],
      });
    }
  },
);

const categoricalBase = {
  shape: z.literal("categorical"),
  dataset: datasetSlugSchema.default("uk_price_paid"),
  datasetVersion: z.number().int().positive().optional(),
  order: z.enum(["ascending", "descending"]),
  limit: z.number().int().min(3).max(50),
  filters: executableFiltersSchema,
};

const categoricalComparisonRequestSchema = z.object({
  ...categoricalBase,
  operation: z.literal("comparison"),
  metric: aggregateMetricSchema,
  dimension: categoricalDimensionSchema,
  transform: z.literal("value"),
});

const rankingRequestSchema = z.object({
  ...categoricalBase,
  operation: z.literal("ranking"),
  metric: aggregateMetricSchema,
  dimension: categoricalDimensionSchema,
  transform: z.literal("value"),
});

const categoricalCompositionRequestSchema = z.object({
  ...categoricalBase,
  operation: z.literal("composition"),
  metric: z.literal("transaction_count"),
  dimension: compactDimensionSchema,
  transform: z.literal("share"),
});

const categoricalRequestUnion = z.discriminatedUnion("operation", [
  categoricalComparisonRequestSchema,
  rankingRequestSchema,
  categoricalCompositionRequestSchema,
]);

const categoricalRequestSchema = categoricalRequestUnion.superRefine(
  (request, context) => {
    if (
      request.operation === "comparison" &&
      !hasBoundedGeography(request.dimension, request.filters)
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Geographical comparisons require one to five explicit locations at the same level",
        path: ["dimension"],
      });
    }
  },
);

const histogramRequestSchema = z.object({
  shape: z.literal("histogram"),
  dataset: datasetSlugSchema.default("uk_price_paid"),
  datasetVersion: z.number().int().positive().optional(),
  operation: z.literal("distribution"),
  field: z.literal("price"),
  splitBy: compactDimensionSchema.nullable(),
  bucketWidth: z.union([
    z.literal(10_000),
    z.literal(25_000),
    z.literal(50_000),
    z.literal(100_000),
    z.literal(250_000),
    z.literal(500_000),
  ]),
  maximumBins: z.number().int().min(8).max(40),
  filters: executableFiltersSchema,
});

const heatmapDimensionSchema = z.enum([
  "year",
  "quarter_of_year",
  "month_of_year",
  "property_type",
  "tenure",
  "new_build",
]);

const matrixRequestSchema = z
  .object({
    shape: z.literal("matrix"),
    dataset: datasetSlugSchema.default("uk_price_paid"),
    datasetVersion: z.number().int().positive().optional(),
    operation: z.literal("heatmap"),
    metric: aggregateMetricSchema,
    xDimension: heatmapDimensionSchema,
    yDimension: heatmapDimensionSchema,
    filters: executableFiltersSchema,
  })
  .refine((request) => request.xDimension !== request.yDimension, {
    message: "Heatmap axes must use different dimensions",
    path: ["yDimension"],
  });

const explorationRequestSchema = z.object({
  shape: z.literal("exploration"),
  dataset: datasetSlugSchema.default("uk_price_paid"),
  datasetVersion: z.number().int().positive().optional(),
  operation: z.literal("exploration"),
  valueField: z.literal("price"),
  dimensions: z
    .array(compactDimensionSchema)
    .min(1)
    .max(3)
    .refine((dimensions) => new Set(dimensions).size === dimensions.length, {
      message: "Exploration dimensions must be unique",
    }),
  bucketMinimum: z.number().int().min(0).max(100_000_000),
  bucketWidth: z.literal(50_000),
  binCount: z.literal(64),
  rowLimit: z.literal(1_000_000),
  filters: executableFiltersSchema,
}).refine(
  (request) =>
    request.dataset === "uk_price_paid" ||
    request.datasetVersion !== undefined,
  {
    message: "Registered datasets require an immutable version",
    path: ["datasetVersion"],
  },
).refine(
  (request) => {
    const start = Date.parse(`${request.filters.dateFrom}T00:00:00Z`);
    const end = Date.parse(`${request.filters.dateTo}T00:00:00Z`);

    return Math.floor((end - start) / 86_400_000) + 1 <= 366;
  },
  {
    message: "Interactive exploration supports at most 366 days",
    path: ["filters", "dateTo"],
  },
).refine(
  (request) =>
    request.bucketMinimum === (request.filters.minimumPrice ?? 0),
  {
    message: "The exploration bucket minimum must match the price filter",
    path: ["bucketMinimum"],
  },
);

export const executableAnalysisRequestSchema = z.union([
  ...timeSeriesRequestUnion.options,
  ...categoricalRequestUnion.options,
  histogramRequestSchema,
  matrixRequestSchema,
  explorationRequestSchema,
]).superRefine((request, context) => {
  if (request.dataset !== "uk_price_paid" && request.datasetVersion === undefined) {
    context.addIssue({
      code: "custom",
      message: "Registered datasets require an immutable version",
      path: ["datasetVersion"],
    });
  }

  if (
    request.shape === "time_series" &&
    !hasBoundedGeography(request.seriesBy, request.filters)
  ) {
    context.addIssue({
      code: "custom",
      message:
        "Geographical series require one to five explicit locations at the same level",
      path: ["seriesBy"],
    });
  }

  if (
    request.shape === "categorical" &&
    request.operation === "comparison" &&
    !hasBoundedGeography(request.dimension, request.filters)
  ) {
    context.addIssue({
      code: "custom",
      message:
        "Geographical comparisons require one to five explicit locations at the same level",
      path: ["dimension"],
    });
  }
});

export {
  categoricalRequestSchema,
  executableFiltersSchema,
  histogramRequestSchema,
  explorationRequestSchema,
  matrixRequestSchema,
  timeSeriesRequestSchema,
};

export type ExecutableAnalysisRequest = z.infer<
  typeof executableAnalysisRequestSchema
>;

export type ExecutableFilters = z.infer<typeof executableFiltersSchema>;

export type GrammarTimeSeriesRequest = z.infer<
  typeof timeSeriesRequestSchema
>;

export type CategoricalRequest = z.infer<typeof categoricalRequestSchema>;

export type HistogramRequest = z.infer<typeof histogramRequestSchema>;

export type MatrixRequest = z.infer<typeof matrixRequestSchema>;

export type ExplorationRequest = z.infer<typeof explorationRequestSchema>;
