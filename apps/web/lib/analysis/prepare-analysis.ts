import { err, ok, type Result } from "neverthrow";

import type {
  AnalysisFilters,
  AnalysisPlan,
  CategoricalDimension,
} from "./contracts";
import {
  executableFiltersSchema,
  executableAnalysisRequestSchema,
  type ExecutableAnalysisRequest,
  type ExecutableFilters,
} from "./execution";
import type { AnalysisToolOutput } from "./tool-output";

const DATASET_START = "1995-01-01";
const DATASET_END = "2024-01-31";

export type UnsupportedAnalysisPlanError = {
  readonly type: "unsupported_analysis_plan";
  readonly message: string;
};

function unsupported(message: string): UnsupportedAnalysisPlanError {
  return {
    type: "unsupported_analysis_plan",
    message,
  };
}

function normalizeFilters(
  filters: AnalysisFilters,
): Result<ExecutableFilters, UnsupportedAnalysisPlanError> {
  const location =
    filters.location === null
      ? null
      : {
          level: filters.location.level,
          values: [...new Set(filters.location.values.map((value) => value.toUpperCase()))],
        };
  const parsed = executableFiltersSchema.safeParse({
    ...filters,
    dateFrom: filters.dateFrom ?? DATASET_START,
    dateTo: filters.dateTo ?? DATASET_END,
    location,
  });

  if (!parsed.success) {
    return err(
      unsupported(
        parsed.error.issues[0]?.message ?? "The analysis filters are invalid",
      ),
    );
  }

  return ok(parsed.data);
}

function requiresExplicitSeries(
  dimension: CategoricalDimension | null,
  filters: ExecutableFilters,
): boolean {
  if (
    dimension !== "town" &&
    dimension !== "district" &&
    dimension !== "county"
  ) {
    return false;
  }

  return (
    filters.location === null ||
    filters.location.level !== dimension ||
    filters.location.values.length > 5
  );
}

function calendarYearCount(dateFrom: string, dateTo: string): number {
  return Number(dateTo.slice(0, 4)) - Number(dateFrom.slice(0, 4)) + 1;
}

function calendarDayCount(dateFrom: string, dateTo: string): number {
  const start = Date.parse(`${dateFrom}T00:00:00Z`);
  const end = Date.parse(`${dateTo}T00:00:00Z`);

  return Math.floor((end - start) / 86_400_000) + 1;
}

export function toExecutableAnalysis(
  plan: AnalysisPlan,
): Result<ExecutableAnalysisRequest, UnsupportedAnalysisPlanError> {
  return normalizeFilters(plan.filters).andThen((filters) => {
    let request: ExecutableAnalysisRequest;

    switch (plan.operation) {
      case "trend":
        if (requiresExplicitSeries(plan.splitBy, filters)) {
          return err(
            unsupported(
              "Geographical trend series require one to five explicit locations at the same level",
            ),
          );
        }

        request = {
          shape: "time_series",
          operation: "trend",
          metric: plan.metric,
          interval: plan.interval,
          seriesBy: plan.splitBy,
          transform: plan.transform,
          anomalyThreshold: null,
          filters,
        };
        break;

      case "comparison":
        if (requiresExplicitSeries(plan.compareBy, filters)) {
          return err(
            unsupported(
              "Geographical comparisons require one to five explicit locations at the same level",
            ),
          );
        }

        request =
          plan.interval === null
            ? {
                shape: "categorical",
                operation: "comparison",
                metric: plan.metric,
                dimension: plan.compareBy,
                transform: "value",
                order: "descending",
                limit: 20,
                filters,
              }
            : {
                shape: "time_series",
                operation: "comparison",
                metric: plan.metric,
                interval: plan.interval,
                seriesBy: plan.compareBy,
                transform: "value",
                anomalyThreshold: null,
                filters,
              };
        break;

      case "ranking":
        request = {
          shape: "categorical",
          operation: "ranking",
          metric: plan.metric,
          dimension: plan.rankBy,
          transform: "value",
          order: plan.order,
          limit: plan.limit,
          filters,
        };
        break;

      case "distribution":
        request = {
          shape: "histogram",
          operation: "distribution",
          field: plan.field,
          splitBy: plan.splitBy,
          bucketWidth: plan.binning.width,
          maximumBins: plan.binning.maximumBins,
          filters,
        };
        break;

      case "composition":
        request =
          plan.interval === null
            ? {
                shape: "categorical",
                operation: "composition",
                metric: "transaction_count",
                dimension: plan.dimension,
                transform: "share",
                order: "descending",
                limit: 20,
                filters,
              }
            : {
                shape: "time_series",
                operation: "composition",
                metric: "transaction_count",
                interval: plan.interval,
                seriesBy: plan.dimension,
                transform: "share",
                anomalyThreshold: null,
                filters,
              };
        break;

      case "heatmap":
        request = {
          shape: "matrix",
          operation: "heatmap",
          metric: plan.metric,
          xDimension: plan.xDimension,
          yDimension: plan.yDimension,
          filters,
        };
        break;

      case "anomaly":
        if (requiresExplicitSeries(plan.splitBy, filters)) {
          return err(
            unsupported(
              "Geographical anomaly series require one to five explicit locations at the same level",
            ),
          );
        }

        if (calendarYearCount(filters.dateFrom, filters.dateTo) < 5) {
          return err(
            unsupported(
              "Robust anomaly detection requires at least five years of history",
            ),
          );
        }

        request = {
          shape: "time_series",
          operation: "anomaly",
          metric: plan.metric,
          interval: plan.interval,
          seriesBy: plan.splitBy,
          transform: "anomaly_score",
          anomalyThreshold: plan.sensitivity === "high" ? 2.5 : 3.5,
          filters,
        };
        break;

      case "exploration":
        if (calendarDayCount(filters.dateFrom, filters.dateTo) > 366) {
          return err(
            unsupported(
              "Interactive exploration supports at most 366 days so the complete workspace remains bounded",
            ),
          );
        }

        request = {
          shape: "exploration",
          operation: "exploration",
          valueField: plan.valueField,
          dimensions: plan.dimensions,
          bucketMinimum: filters.minimumPrice ?? 0,
          bucketWidth: 50_000,
          binCount: 64,
          rowLimit: 1_000_000,
          filters,
        };
        break;
    }

    const parsed = executableAnalysisRequestSchema.safeParse(request);

    return parsed.success
      ? ok(parsed.data)
      : err(
          unsupported(
            parsed.error.issues[0]?.message ?? "The analysis plan is invalid",
          ),
        );
  });
}

export function prepareAnalysis(plan: AnalysisPlan): AnalysisToolOutput {
  const request = toExecutableAnalysis(plan);

  if (request.isErr()) {
    return {
      status: "unsupported",
      plan,
      error: request.error,
    };
  }

  return {
    status: "ready",
    plan,
    request: request.value,
  };
}
