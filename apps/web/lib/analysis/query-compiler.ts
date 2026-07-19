import { err, ok, type Result } from "neverthrow";

import type { AnalysisPlan } from "./contracts";

const YEARLY_AVERAGE_PRICE_BY_TOWN_QUERY = `
  SELECT
    toYear(date) AS year,
    round(avg(price)) AS average_price,
    count() AS transaction_count
  FROM pp_complete
  WHERE date >= {dateFrom: Date}
    AND date <= {dateTo: Date}
    AND town IN {towns: Array(String)}
  GROUP BY year
  ORDER BY year ASC
`;

export type CompiledAnalysisQuery = {
  readonly query: string;
  readonly queryParams: {
    readonly dateFrom: string;
    readonly dateTo: string;
    readonly towns: string[];
  };
};

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

export function compileAnalysisQuery(
  plan: AnalysisPlan,
): Result<CompiledAnalysisQuery, UnsupportedAnalysisPlanError> {
  if (
    plan.analysisType !== "trend" ||
    plan.metric !== "average_price" ||
    plan.visualization !== "time_series"
  ) {
    return err(
      unsupported(
        "Only average-price trend analyses using a time-series visualization are currently supported",
      ),
    );
  }

  if (plan.groupBy.length !== 1 || plan.groupBy[0] !== "year") {
    return err(
      unsupported("The first analysis slice only supports grouping by year"),
    );
  }

  const location = plan.filters.location;

  if (
    location === null ||
    location.level !== "town" ||
    location.values.length === 0
  ) {
    return err(
      unsupported("The first analysis slice requires at least one town"),
    );
  }

  const hasUnsupportedFilters =
    plan.filters.propertyTypes.length > 0 ||
    plan.filters.newBuild !== null ||
    plan.filters.tenure.length > 0 ||
    plan.filters.maximumPrice !== null ||
    plan.limit !== null ||
    plan.order === "descending";

  if (hasUnsupportedFilters) {
    return err(
      unsupported("This analysis contains filters that are not supported yet"),
    );
  }

  const dateFrom = plan.filters.dateFrom ?? "1995-01-01";
  const dateTo = plan.filters.dateTo ?? "2024-01-31";

  if (dateFrom > dateTo) {
    return err(
      unsupported("The analysis start date must be before its end date"),
    );
  }

  return ok({
    query: YEARLY_AVERAGE_PRICE_BY_TOWN_QUERY,
    queryParams: {
      dateFrom,
      dateTo,
      towns: location.values.map((town) => town.toUpperCase()),
    },
  });
}
