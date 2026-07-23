import { err, ok, type Result } from "neverthrow";
import { z } from "zod";

import { datasetSlugSchema } from "../data-sources/contracts";
import {
  aggregationSchema,
  analyticalFormatSchema,
  deriveAnalyticalCapabilities,
  findAnalyticalDimension,
  findAnalyticalMeasure,
  semanticKeySchema,
  type AnalyticalTableManifest,
} from "../data-sources/semantic";
import { timeIntervalSchema } from "./contracts";

export const semanticMetricReferenceSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("row_count"),
  }),
  z.object({
    kind: z.literal("measure"),
    measure: semanticKeySchema,
    aggregation: aggregationSchema,
  }),
]);

const semanticScalarSchema = z.union([
  z.string().trim().min(1).max(160),
  z.number().finite(),
  z.boolean(),
]);

export const semanticFiltersSchema = z
  .object({
    timeRange: z
      .object({
        from: z.iso.date(),
        to: z.iso.date(),
      })
      .refine((range) => range.from <= range.to, {
        message: "The start date must be before the end date",
        path: ["to"],
      })
      .nullable(),
    dimensions: z
      .array(
        z.object({
          dimension: semanticKeySchema,
          values: z.array(semanticScalarSchema).min(1).max(50),
        }),
      )
      .max(12)
      .refine(
        (filters) =>
          new Set(filters.map((filter) => filter.dimension)).size ===
          filters.length,
        { message: "Dimension filters must be unique" },
      ),
    measures: z
      .array(
        z
          .object({
            measure: semanticKeySchema,
            minimum: z.number().finite().nullable(),
            maximum: z.number().finite().nullable(),
          })
          .refine(
            (filter) =>
              filter.minimum === null ||
              filter.maximum === null ||
              filter.minimum <= filter.maximum,
            {
              message: "The minimum must not exceed the maximum",
              path: ["maximum"],
            },
          ),
      )
      .max(8)
      .refine(
        (filters) =>
          new Set(filters.map((filter) => filter.measure)).size ===
          filters.length,
        { message: "Measure filters must be unique" },
      ),
  })
  .default({
    timeRange: null,
    dimensions: [],
    measures: [],
  });

const semanticPlanBase = {
  version: z.literal(1),
  dataset: datasetSlugSchema,
  datasetVersion: z.number().int().positive(),
  title: z.string().trim().min(1).max(100),
  explanation: z.string().trim().min(1).max(320),
  filters: semanticFiltersSchema,
};

const semanticTrendPlanSchema = z.object({
  ...semanticPlanBase,
  operation: z.literal("trend"),
  metric: semanticMetricReferenceSchema,
  interval: timeIntervalSchema,
  splitBy: semanticKeySchema.nullable(),
});

const semanticComparisonPlanSchema = z.object({
  ...semanticPlanBase,
  operation: z.literal("comparison"),
  metric: semanticMetricReferenceSchema,
  compareBy: semanticKeySchema,
  interval: timeIntervalSchema.nullable(),
});

const semanticRankingPlanSchema = z.object({
  ...semanticPlanBase,
  operation: z.literal("ranking"),
  metric: semanticMetricReferenceSchema,
  rankBy: semanticKeySchema,
  order: z.enum(["ascending", "descending"]),
  limit: z.number().int().min(3).max(50),
});

const semanticDistributionPlanSchema = z.object({
  ...semanticPlanBase,
  operation: z.literal("distribution"),
  measure: semanticKeySchema,
  splitBy: semanticKeySchema.nullable(),
  bucketMinimum: z.number().finite(),
  bucketWidth: z.number().positive().finite(),
  maximumBins: z.number().int().min(8).max(100),
});

const semanticCompositionPlanSchema = z.object({
  ...semanticPlanBase,
  operation: z.literal("composition"),
  dimension: semanticKeySchema,
  interval: timeIntervalSchema.nullable(),
});

const semanticAnomalyPlanSchema = z.object({
  ...semanticPlanBase,
  operation: z.literal("anomaly"),
  metric: semanticMetricReferenceSchema,
  interval: z.enum(["year", "month"]),
  splitBy: semanticKeySchema.nullable(),
  threshold: z.number().min(2).max(5),
});

export const semanticAnalysisPlanSchema = z.discriminatedUnion("operation", [
  semanticTrendPlanSchema,
  semanticComparisonPlanSchema,
  semanticRankingPlanSchema,
  semanticDistributionPlanSchema,
  semanticCompositionPlanSchema,
  semanticAnomalyPlanSchema,
]);

export type SemanticMetricReference = z.infer<
  typeof semanticMetricReferenceSchema
>;
export type SemanticFilters = z.infer<typeof semanticFiltersSchema>;
export type SemanticAnalysisPlan = z.infer<
  typeof semanticAnalysisPlanSchema
>;

export type SemanticPlanError = {
  readonly type: "semantic_plan_error";
  readonly message: string;
};

const semanticPresentationSchema = z.object({
  valueLabel: z.string().trim().min(1).max(80),
  valueFormat: analyticalFormatSchema,
  categoryLabel: z.string().trim().min(1).max(80).nullable(),
  distributionMeasureFormat: analyticalFormatSchema.nullable(),
});

export const semanticAnalysisRequestSchema = z.object({
  shape: z.enum(["time_series", "categorical", "histogram"]),
  plan: semanticAnalysisPlanSchema,
  transform: z.enum(["value", "share", "anomaly_score"]),
  presentation: semanticPresentationSchema,
});

export type SemanticAnalysisRequest = z.infer<
  typeof semanticAnalysisRequestSchema
>;

function invalid(message: string): SemanticPlanError {
  return { type: "semantic_plan_error", message };
}

function validateMetric(
  metric: SemanticMetricReference,
  manifest: AnalyticalTableManifest,
): Result<void, SemanticPlanError> {
  if (metric.kind === "row_count") {
    return ok(undefined);
  }

  const measure = findAnalyticalMeasure(manifest, metric.measure);

  if (measure === null) {
    return err(invalid(`Unknown measure ${metric.measure}`));
  }

  return measure.aggregations.includes(metric.aggregation)
    ? ok(undefined)
    : err(
        invalid(
          `Measure ${metric.measure} does not support ${metric.aggregation}`,
        ),
      );
}

export function validateSemanticAnalysisPlan(
  plan: SemanticAnalysisPlan,
  manifest: AnalyticalTableManifest,
): Result<SemanticAnalysisPlan, SemanticPlanError> {
  const capabilities = deriveAnalyticalCapabilities(manifest);

  if (!capabilities.operations[plan.operation]) {
    return err(
      invalid(`The dataset does not support ${plan.operation} analysis`),
    );
  }

  for (const filter of plan.filters.dimensions) {
    if (findAnalyticalDimension(manifest, filter.dimension) === null) {
      return err(invalid(`Unknown dimension ${filter.dimension}`));
    }
  }

  for (const filter of plan.filters.measures) {
    if (findAnalyticalMeasure(manifest, filter.measure) === null) {
      return err(invalid(`Unknown measure ${filter.measure}`));
    }
  }

  if (plan.filters.timeRange !== null && manifest.time === null) {
    return err(invalid("The dataset does not declare a time field"));
  }

  const metric =
    plan.operation === "distribution" || plan.operation === "composition"
      ? ok(undefined)
      : validateMetric(plan.metric, manifest);

  if (metric.isErr()) {
    return err(metric.error);
  }

  const interval =
    plan.operation === "trend" ||
    plan.operation === "anomaly" ||
    (plan.operation === "comparison" && plan.interval !== null) ||
    (plan.operation === "composition" && plan.interval !== null)
      ? plan.interval
      : null;

  if (
    interval !== null &&
    !manifest.time?.granularities.includes(interval)
  ) {
    return err(invalid(`The dataset does not support ${interval} buckets`));
  }

  const dimension =
    plan.operation === "trend" || plan.operation === "anomaly"
      ? plan.splitBy
      : plan.operation === "comparison"
        ? plan.compareBy
        : plan.operation === "ranking"
          ? plan.rankBy
          : plan.operation === "distribution"
            ? plan.splitBy
            : plan.dimension;

  if (
    dimension !== null &&
    findAnalyticalDimension(manifest, dimension) === null
  ) {
    return err(invalid(`Unknown dimension ${dimension}`));
  }

  if (plan.operation === "distribution") {
    const measure = findAnalyticalMeasure(manifest, plan.measure);

    if (measure === null) {
      return err(invalid(`Unknown measure ${plan.measure}`));
    }

    if (!measure.supportsDistribution) {
      return err(
        invalid(`Measure ${plan.measure} does not support distributions`),
      );
    }
  }

  return ok(plan);
}

function planDimension(plan: SemanticAnalysisPlan): string | null {
  switch (plan.operation) {
    case "trend":
    case "anomaly":
      return plan.splitBy;
    case "comparison":
      return plan.compareBy;
    case "ranking":
      return plan.rankBy;
    case "distribution":
      return plan.splitBy;
    case "composition":
      return plan.dimension;
  }
}

function planShape(
  plan: SemanticAnalysisPlan,
): SemanticAnalysisRequest["shape"] {
  switch (plan.operation) {
    case "trend":
    case "anomaly":
      return "time_series";
    case "comparison":
    case "composition":
      return plan.interval === null ? "categorical" : "time_series";
    case "ranking":
      return "categorical";
    case "distribution":
      return "histogram";
  }
}

export function prepareSemanticAnalysis(
  plan: SemanticAnalysisPlan,
  manifest: AnalyticalTableManifest,
  pinned: {
    readonly dataset: string;
    readonly datasetVersion: number;
  },
): Result<SemanticAnalysisRequest, SemanticPlanError> {
  if (
    plan.dataset !== pinned.dataset ||
    plan.datasetVersion !== pinned.datasetVersion
  ) {
    return err(
      invalid(
        `This chat is pinned to ${pinned.dataset} version ${pinned.datasetVersion}`,
      ),
    );
  }

  return validateSemanticAnalysisPlan(plan, manifest).map((validated) => {
    const metric =
      validated.operation === "distribution" ||
      validated.operation === "composition"
        ? null
        : validated.metric;
    const measure =
      metric?.kind === "measure"
        ? findAnalyticalMeasure(manifest, metric.measure)
        : null;
    const distributionMeasure =
      validated.operation === "distribution"
        ? findAnalyticalMeasure(manifest, validated.measure)
        : null;
    const dimensionKey = planDimension(validated);
    const dimension =
      dimensionKey === null
        ? null
        : findAnalyticalDimension(manifest, dimensionKey);
    const isComposition = validated.operation === "composition";
    const request = {
      shape: planShape(validated),
      plan: validated,
      transform:
        validated.operation === "anomaly"
          ? ("anomaly_score" as const)
          : isComposition
            ? ("share" as const)
            : ("value" as const),
      presentation: {
        valueLabel: isComposition
          ? "Share"
          : metric?.kind === "row_count"
            ? "Rows"
            : (measure?.label ?? distributionMeasure?.label ?? "Value"),
        valueFormat: isComposition
          ? {
              kind: "percent" as const,
              maximumFractionDigits: 1,
            }
          : metric?.kind === "row_count" ||
              validated.operation === "distribution"
            ? {
                kind: "number" as const,
                maximumFractionDigits: 0,
              }
            : (measure?.format ?? {
                kind: "number" as const,
                maximumFractionDigits: 2,
              }),
        categoryLabel: dimension?.label ?? null,
        distributionMeasureFormat: distributionMeasure?.format ?? null,
      },
    };

    return semanticAnalysisRequestSchema.parse(request);
  });
}
