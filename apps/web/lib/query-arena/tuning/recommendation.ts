import { err, ok, type Result } from "neverthrow";

import type { AnalysisDataSource } from "../../data-sources/contracts";
import { findAnalyticalDimension } from "../../data-sources/semantic";
import type { QueryArenaRequest } from "../contracts";

import type { TuningTemplate } from "./contracts";

export type TuningRecommendationError = {
  readonly type: "tuning_recommendation_error";
  readonly message: string;
};

function requestedDimensions(analysis: QueryArenaRequest): readonly string[] {
  if (analysis.kind === "time_series") {
    return [
      analysis.request.seriesBy,
      analysis.request.filters.location?.level ?? null,
      analysis.request.filters.propertyTypes.length > 0
        ? "property_type"
        : null,
      analysis.request.filters.tenure.length > 0 ? "tenure" : null,
      analysis.request.filters.newBuild !== null ? "new_build" : null,
    ].flatMap((key) => (key === null ? [] : [key]));
  }

  const plan = analysis.request.plan;
  const grouped =
    plan.operation === "comparison"
      ? plan.compareBy
      : plan.operation === "ranking"
        ? plan.rankBy
        : plan.operation === "composition"
          ? plan.dimension
          : plan.splitBy;

  return [
    ...(grouped === null ? [] : [grouped]),
    ...plan.filters.dimensions.map((filter) => filter.dimension),
  ];
}

export function recommendOrderedProjection(
  source: AnalysisDataSource,
  analysis: QueryArenaRequest,
): Result<TuningTemplate, TuningRecommendationError> {
  if (source.manifest.time === null) {
    return err({
      type: "tuning_recommendation_error",
      message: "Physical tuning requires a declared time field",
    });
  }

  const requested = [...new Set(requestedDimensions(analysis))];
  const safeDimensions = source.manifest.dimensions
    .filter((dimension) =>
      /^[A-Za-z_][A-Za-z0-9_]*$/.test(dimension.filterExpression),
    )
    .map((dimension) => dimension.key);
  const requestedSafe = requested.filter((key) => {
      const dimension = findAnalyticalDimension(source.manifest, key);
      return (
        dimension !== null &&
        /^[A-Za-z_][A-Za-z0-9_]*$/.test(dimension.filterExpression)
      );
    });
  const dimensions = (
    requestedSafe.length === 0 ? safeDimensions.slice(0, 1) : requestedSafe
  ).slice(0, 3);

  if (dimensions.length === 0) {
    return err({
      type: "tuning_recommendation_error",
      message: "No safe physical dimension is available for this pattern",
    });
  }

  return ok({
    kind: "ordered_projection_v1",
    timeKey: source.manifest.time.key,
    dimensionKeys: dimensions,
  });
}
