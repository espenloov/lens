import { err, ok, type Result } from "neverthrow";

import {
  timeSeriesRequestSchema,
  type TimeSeriesRequest,
} from "../time-series/contracts";

import type { AnalysisPlan } from "./contracts";

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

export function toTimeSeriesRequest(
  plan: AnalysisPlan,
): Result<TimeSeriesRequest, UnsupportedAnalysisPlanError> {
  if (plan.analysisType !== "trend" && plan.analysisType !== "comparison") {
    return err(
      unsupported("This version supports time-series trends and comparisons"),
    );
  }

  if (
    plan.metric !== "average_price" &&
    plan.metric !== "transaction_count"
  ) {
    return err(
      unsupported("This version supports average price and transaction count"),
    );
  }

  if (
    plan.visualization !== "time_series" &&
    plan.visualization !== "comparison"
  ) {
    return err(unsupported("This analysis requires a time-series visualization"));
  }

  const intervals = plan.groupBy.filter(
    (dimension): dimension is "year" | "month" =>
      dimension === "year" || dimension === "month",
  );

  if (intervals.length !== 1) {
    return err(unsupported("Choose exactly one time interval: year or month"));
  }

  const location = plan.filters.location;

  if (
    location === null ||
    (location.level !== "town" && location.level !== "county") ||
    location.values.length === 0
  ) {
    return err(unsupported("Choose between one and five towns or counties"));
  }

  const nonTimeDimensions = plan.groupBy.filter(
    (dimension) => dimension !== "year" && dimension !== "month",
  );

  if (
    nonTimeDimensions.some((dimension) => dimension !== location.level)
  ) {
    return err(
      unsupported("The comparison dimension must match the selected location level"),
    );
  }

  if (
    plan.filters.newBuild !== null ||
    plan.filters.tenure.length > 0 ||
    plan.filters.maximumPrice !== null
  ) {
    return err(
      unsupported(
        "New-build, tenure, and maximum-price filters are not supported yet",
      ),
    );
  }

  const request = timeSeriesRequestSchema.safeParse({
    metric: plan.metric,
    interval: intervals[0],
    dateFrom: plan.filters.dateFrom ?? "1995-01-01",
    dateTo: plan.filters.dateTo ?? "2024-01-31",
    location,
    propertyTypes: plan.filters.propertyTypes,
  });

  if (!request.success) {
    return err(
      unsupported(
        request.error.issues[0]?.message ?? "The time-series request is invalid",
      ),
    );
  }

  return ok(request.data);
}
