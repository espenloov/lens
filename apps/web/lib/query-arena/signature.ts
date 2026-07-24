import { createHash } from "node:crypto";

import type { TimeSeriesRequest } from "../time-series/contracts";
import { queryArenaTimeSeriesRequestSchema } from "../time-series/contracts";
import {
  queryArenaRequestSchema,
  type QueryArenaRequest,
} from "./contracts";

const DAY_MS = 86_400_000;

type SelectionCardinality =
  | "none"
  | "single"
  | "small"
  | "medium"
  | "large";

function hash(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(value))
    .digest("hex");
}

function classifySelectionCardinality(count: number): SelectionCardinality {
  if (count === 0) {
    return "none";
  }

  if (count === 1) {
    return "single";
  }

  if (count <= 5) {
    return "small";
  }

  if (count <= 20) {
    return "medium";
  }

  return "large";
}

function classifyTimeRange(
  from: string | null,
  to: string | null,
): "none" | "short" | "medium" | "long" | "historical" {
  if (from === null || to === null) {
    return "none";
  }

  const durationDays =
    Math.floor((Date.parse(to) - Date.parse(from)) / DAY_MS) + 1;

  if (durationDays <= 31) {
    return "short";
  }

  if (durationDays <= 366) {
    return "medium";
  }

  if (durationDays <= 1_827) {
    return "long";
  }

  return "historical";
}

function classifyMeasureBounds(
  minimum: number | null,
  maximum: number | null,
): "lower" | "upper" | "range" | "none" {
  if (minimum !== null && maximum !== null) {
    return "range";
  }

  if (minimum !== null) {
    return "lower";
  }

  if (maximum !== null) {
    return "upper";
  }

  return "none";
}

function timeSeriesMetricFamily(metric: TimeSeriesRequest["metric"]) {
  return metric === "transaction_count"
    ? { kind: "row_count" as const }
    : {
        kind: "measure" as const,
        aggregation:
          metric === "average_price" ? ("average" as const) : ("median" as const),
      };
}

function normalizeTimeSeriesSemanticFamily(request: TimeSeriesRequest) {
  const dimensionSelections = [
    ...(request.filters.location === null
      ? []
      : [request.filters.location.values.length]),
    ...(request.filters.propertyTypes.length === 0
      ? []
      : [request.filters.propertyTypes.length]),
    ...(request.filters.tenure.length === 0
      ? []
      : [request.filters.tenure.length]),
    ...(request.filters.newBuild === null ? [] : [1]),
  ];
  const groupedSelection =
    request.seriesBy === null
      ? null
      : request.filters.location?.level === request.seriesBy
        ? request.filters.location.values.length
        : request.seriesBy === "property_type"
          ? request.filters.propertyTypes.length
          : request.seriesBy === "tenure"
            ? request.filters.tenure.length
            : request.seriesBy === "new_build" &&
                request.filters.newBuild !== null
              ? 1
              : 0;

  return {
    schemaVersion: 1,
    shape: request.shape,
    operation: request.operation,
    metric: timeSeriesMetricFamily(request.metric),
    interval: request.interval,
    transform: request.transform,
    grouping:
      groupedSelection === null
        ? { dimensions: 0, cardinality: "none" as const }
        : {
            dimensions: 1,
            cardinality:
              groupedSelection === 0
                ? ("unknown" as const)
                : classifySelectionCardinality(groupedSelection),
          },
    filters: {
      timeRange: classifyTimeRange(
        request.filters.dateFrom,
        request.filters.dateTo,
      ),
      dimensions: dimensionSelections
        .map(classifySelectionCardinality)
        .sort(),
      measures: [
        classifyMeasureBounds(
          request.filters.minimumPrice,
          request.filters.maximumPrice,
        ),
      ].filter((value) => value !== "none"),
    },
  };
}

function semanticPlanDimension(
  plan: Extract<QueryArenaRequest, { kind: "semantic" }>["request"]["plan"],
): string | null {
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

function semanticPlanMetric(
  plan: Extract<QueryArenaRequest, { kind: "semantic" }>["request"]["plan"],
) {
  if (plan.operation === "distribution") {
    return { kind: "distribution" as const };
  }

  if (plan.operation === "composition") {
    return { kind: "row_count" as const };
  }

  return plan.metric.kind === "row_count"
    ? { kind: "row_count" as const }
    : {
        kind: "measure" as const,
        aggregation: plan.metric.aggregation,
      };
}

function semanticPlanInterval(
  plan: Extract<QueryArenaRequest, { kind: "semantic" }>["request"]["plan"],
) {
  switch (plan.operation) {
    case "trend":
    case "anomaly":
      return plan.interval;
    case "comparison":
    case "composition":
      return plan.interval;
    case "ranking":
    case "distribution":
      return null;
  }
}

function normalizeGenericSemanticFamily(
  analysis: Extract<QueryArenaRequest, { kind: "semantic" }>,
) {
  const plan = analysis.request.plan;
  const groupedDimension = semanticPlanDimension(plan);
  const groupedFilter =
    groupedDimension === null
      ? undefined
      : plan.filters.dimensions.find(
          (filter) => filter.dimension === groupedDimension,
        );

  return {
    schemaVersion: 1,
    shape: analysis.request.shape,
    operation: plan.operation,
    metric: semanticPlanMetric(plan),
    interval: semanticPlanInterval(plan),
    transform: analysis.request.transform,
    grouping:
      groupedDimension === null
        ? { dimensions: 0, cardinality: "none" as const }
        : {
            dimensions: 1,
            cardinality:
              groupedFilter === undefined
                ? ("unknown" as const)
                : classifySelectionCardinality(groupedFilter.values.length),
          },
    filters: {
      timeRange: classifyTimeRange(
        plan.filters.timeRange?.from ?? null,
        plan.filters.timeRange?.to ?? null,
      ),
      dimensions: plan.filters.dimensions
        .map((filter) =>
          classifySelectionCardinality(filter.values.length),
        )
        .sort(),
      measures: plan.filters.measures
        .map((filter) =>
          classifyMeasureBounds(filter.minimum, filter.maximum),
        )
        .filter((value) => value !== "none")
        .sort(),
    },
  };
}

export function normalizeTimeSeriesRequest(request: TimeSeriesRequest) {
  return {
    schemaVersion: 4,
    dataset: request.dataset,
    datasetVersion: request.datasetVersion ?? 1,
    shape: request.shape,
    operation: request.operation,
    metric: request.metric,
    interval: request.interval,
    seriesBy: request.seriesBy,
    transform: request.transform,
    anomalyThreshold: request.anomalyThreshold,
    filters: {
      ...request.filters,
      location:
        request.filters.location === null
          ? null
          : {
              level: request.filters.location.level,
              values: request.filters.location.values
                .map((value) => value.trim().toUpperCase())
                .sort(),
            },
      propertyTypes: [...request.filters.propertyTypes].sort(),
      tenure: [...request.filters.tenure].sort(),
    },
  };
}

export function createArenaId(
  signature: string,
  requestId: string,
): string {
  const bytes = createHash("sha256")
    .update(`${signature}:${requestId}`)
    .digest()
    .subarray(0, 16);

  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function createAnalysisSignature(request: TimeSeriesRequest): string {
  return hash({
    schemaVersion: 5,
    kind: "time_series",
    request: normalizeTimeSeriesRequest(request),
  });
}

export function supportsQueryArena(request: TimeSeriesRequest): boolean {
  return queryArenaTimeSeriesRequestSchema.safeParse(request).success;
}

function normalizeSemanticAnalysis(
  analysis: Extract<QueryArenaRequest, { kind: "semantic" }>,
) {
  const plan = {
    ...analysis.request.plan,
    title: "",
    explanation: "",
  };

  return {
    schemaVersion: 5,
    kind: analysis.kind,
    request: {
      shape: analysis.request.shape,
      transform: analysis.request.transform,
      plan: {
        ...plan,
        filters: {
          timeRange: plan.filters.timeRange,
          dimensions: [...plan.filters.dimensions]
            .map((filter) => ({
              dimension: filter.dimension,
              values: [...filter.values].sort((left, right) =>
                String(left).localeCompare(String(right)),
              ),
            }))
            .sort((left, right) =>
              left.dimension.localeCompare(right.dimension),
            ),
          measures: [...plan.filters.measures].sort((left, right) =>
            left.measure.localeCompare(right.measure),
          ),
        },
      },
    },
  };
}

export function normalizeQueryArenaRequest(analysis: QueryArenaRequest) {
  return analysis.kind === "time_series"
    ? {
        schemaVersion: 5,
        kind: analysis.kind,
        request: normalizeTimeSeriesRequest(analysis.request),
      }
    : normalizeSemanticAnalysis(analysis);
}

function normalizeExecutionContext(analysis: QueryArenaRequest) {
  const family = normalizeSemanticFamily(analysis);

  if (analysis.kind === "time_series") {
    const request = analysis.request;

    return {
      schemaVersion: 1,
      dataset: request.dataset,
      datasetVersion: request.datasetVersion ?? 1,
      family,
      physicalRoles: {
        metric: request.metric,
        seriesBy: request.seriesBy,
        locationLevel: request.filters.location?.level ?? null,
        filters: {
          propertyType: request.filters.propertyTypes.length > 0,
          newBuild: request.filters.newBuild !== null,
          tenure: request.filters.tenure.length > 0,
          minimumPrice: request.filters.minimumPrice !== null,
          maximumPrice: request.filters.maximumPrice !== null,
        },
      },
    };
  }

  const plan = analysis.request.plan;

  return {
    schemaVersion: 1,
    dataset: plan.dataset,
    datasetVersion: plan.datasetVersion,
    family,
    physicalRoles: {
      metric:
        plan.operation === "distribution"
          ? { measure: plan.measure }
          : plan.operation === "composition"
            ? { kind: "row_count" as const }
            : plan.metric,
      dimension: semanticPlanDimension(plan),
      dimensionFilters: plan.filters.dimensions
        .map((filter) => ({
          dimension: filter.dimension,
          cardinality: classifySelectionCardinality(filter.values.length),
        }))
        .sort((left, right) =>
          left.dimension.localeCompare(right.dimension),
        ),
      measureFilters: plan.filters.measures
        .map((filter) => ({
          measure: filter.measure,
          bounds: classifyMeasureBounds(filter.minimum, filter.maximum),
        }))
        .sort((left, right) => left.measure.localeCompare(right.measure)),
    },
  };
}

export function normalizeSemanticFamily(analysis: QueryArenaRequest) {
  const validated = queryArenaRequestSchema.parse(analysis);

  return validated.kind === "time_series"
    ? normalizeTimeSeriesSemanticFamily(validated.request)
    : normalizeGenericSemanticFamily(validated);
}

export function createSemanticFamilyHash(
  analysis: QueryArenaRequest,
): string {
  return hash(normalizeSemanticFamily(analysis));
}

export function createQueryArenaSignature(
  analysis: QueryArenaRequest,
): string {
  const validated = queryArenaRequestSchema.parse(analysis);

  return hash(normalizeExecutionContext(validated));
}

export function createQueryArenaIdentity(analysis: QueryArenaRequest) {
  const validated = queryArenaRequestSchema.parse(analysis);

  return {
    executionSignature: createQueryArenaSignature(validated),
    semanticFamilyHash: createSemanticFamilyHash(validated),
  };
}
