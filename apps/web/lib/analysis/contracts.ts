import { z } from "zod";

export const analysisQuestionSchema = z.object({
  question: z.string().trim().min(3).max(1_000),
});

export const propertyTypeSchema = z.enum([
  "terraced",
  "semi-detached",
  "detached",
  "flat",
  "other",
]);

export const tenureSchema = z.enum(["freehold", "leasehold", "unknown"]);

export const locationLevelSchema = z.enum(["town", "district", "county"]);

export const aggregateMetricSchema = z.enum([
  "average_price",
  "median_price",
  "transaction_count",
]);

export const timeIntervalSchema = z.enum(["year", "quarter", "month"]);

export const categoricalDimensionSchema = z.enum([
  "town",
  "district",
  "county",
  "property_type",
  "tenure",
  "new_build",
]);

export const compactDimensionSchema = z.enum([
  "property_type",
  "tenure",
  "new_build",
]);

const locationFilterSchema = z.object({
  level: locationLevelSchema,
  values: z.array(z.string().trim().min(1).max(80)).min(1).max(10),
});

export const analysisFiltersSchema = z
  .object({
    dateFrom: z.iso.date().nullable(),
    dateTo: z.iso.date().nullable(),
    location: locationFilterSchema.nullable(),
    propertyTypes: z.array(propertyTypeSchema).max(5),
    newBuild: z.boolean().nullable(),
    tenure: z.array(tenureSchema).max(3),
    minimumPrice: z.number().int().min(1).max(100_000_000).nullable(),
    maximumPrice: z.number().int().min(1).max(100_000_000).nullable(),
  })
  .superRefine((filters, context) => {
    if (
      filters.dateFrom !== null &&
      filters.dateTo !== null &&
      filters.dateFrom > filters.dateTo
    ) {
      context.addIssue({
        code: "custom",
        message: "The start date must be before the end date",
        path: ["dateTo"],
      });
    }

    if (
      filters.minimumPrice !== null &&
      filters.maximumPrice !== null &&
      filters.minimumPrice > filters.maximumPrice
    ) {
      context.addIssue({
        code: "custom",
        message: "The minimum price must not exceed the maximum price",
        path: ["maximumPrice"],
      });
    }
  });

const commonPlanShape = {
  version: z.literal(1),
  dataset: z.literal("uk_price_paid"),
  title: z.string().trim().min(1).max(100),
  explanation: z.string().trim().min(1).max(320),
  filters: analysisFiltersSchema,
};

const trendPlanSchema = z.object({
  ...commonPlanShape,
  operation: z.literal("trend"),
  metric: aggregateMetricSchema,
  interval: timeIntervalSchema,
  splitBy: categoricalDimensionSchema.nullable(),
  transform: z.enum(["value", "period_change_percent"]),
});

const comparisonPlanSchema = z.object({
  ...commonPlanShape,
  operation: z.literal("comparison"),
  metric: aggregateMetricSchema,
  compareBy: categoricalDimensionSchema,
  interval: timeIntervalSchema.nullable(),
});

const rankingPlanSchema = z.object({
  ...commonPlanShape,
  operation: z.literal("ranking"),
  metric: aggregateMetricSchema,
  rankBy: categoricalDimensionSchema,
  order: z.enum(["ascending", "descending"]),
  limit: z.number().int().min(3).max(50),
});

const distributionPlanSchema = z.object({
  ...commonPlanShape,
  operation: z.literal("distribution"),
  field: z.literal("price"),
  splitBy: compactDimensionSchema.nullable(),
  binning: z.object({
    width: z.union([
      z.literal(10_000),
      z.literal(25_000),
      z.literal(50_000),
      z.literal(100_000),
      z.literal(250_000),
      z.literal(500_000),
    ]),
    maximumBins: z.number().int().min(8).max(40),
  }),
});

const compositionPlanSchema = z.object({
  ...commonPlanShape,
  operation: z.literal("composition"),
  dimension: compactDimensionSchema,
  interval: timeIntervalSchema.nullable(),
});

const heatmapDimensionSchema = z.enum([
  "year",
  "quarter_of_year",
  "month_of_year",
  "property_type",
  "tenure",
  "new_build",
]);

const heatmapPlanSchema = z
  .object({
    ...commonPlanShape,
    operation: z.literal("heatmap"),
    metric: aggregateMetricSchema,
    xDimension: heatmapDimensionSchema,
    yDimension: heatmapDimensionSchema,
  })
  .refine((plan) => plan.xDimension !== plan.yDimension, {
    message: "Heatmap axes must use different dimensions",
    path: ["yDimension"],
  });

const anomalyPlanSchema = z.object({
  ...commonPlanShape,
  operation: z.literal("anomaly"),
  metric: aggregateMetricSchema,
  interval: z.enum(["year", "month"]),
  splitBy: categoricalDimensionSchema.nullable(),
  sensitivity: z.enum(["normal", "high"]),
});

const explorationPlanSchema = z.object({
  ...commonPlanShape,
  operation: z.literal("exploration"),
  valueField: z.literal("price"),
  dimensions: z
    .array(compactDimensionSchema)
    .min(1)
    .max(3)
    .refine((dimensions) => new Set(dimensions).size === dimensions.length, {
      message: "Exploration dimensions must be unique",
    }),
});

export const analysisPlanSchema = z.discriminatedUnion("operation", [
  trendPlanSchema,
  comparisonPlanSchema,
  rankingPlanSchema,
  distributionPlanSchema,
  compositionPlanSchema,
  heatmapPlanSchema,
  anomalyPlanSchema,
  explorationPlanSchema,
]);

export const analysisDecisionSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("analysis"),
    plan: analysisPlanSchema,
  }),
  z.object({
    kind: z.literal("clarification"),
    question: z.string().trim().min(1).max(240),
    suggestions: z.array(z.string().trim().min(1).max(80)).max(3),
  }),
]);

export type AnalysisQuestion = z.infer<typeof analysisQuestionSchema>;

export type AnalysisFilters = z.infer<typeof analysisFiltersSchema>;

export type AnalysisPlan = z.infer<typeof analysisPlanSchema>;

export type AnalysisDecision = z.infer<typeof analysisDecisionSchema>;

export type AggregateMetric = z.infer<typeof aggregateMetricSchema>;

export type CategoricalDimension = z.infer<
  typeof categoricalDimensionSchema
>;

export type CompactDimension = z.infer<typeof compactDimensionSchema>;

export type TimeInterval = z.infer<typeof timeIntervalSchema>;
