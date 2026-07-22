import type {
  TimeSeriesInterval,
  TimeSeriesLocationLevel,
  TimeSeriesMetric,
  TimeSeriesPropertyType,
  TimeSeriesRequest,
} from "./contracts";

import type { QueryStrategy } from "@/lib/query-arena/contracts";

const PERIOD_EXPRESSIONS: Record<TimeSeriesInterval, string> = {
  year: "toDate(toStartOfYear(date))",
  month: "toDate(toStartOfMonth(date))",
};

const LOCATION_COLUMNS: Record<TimeSeriesLocationLevel, string> = {
  town: "town",
  county: "county",
};

const METRIC_EXPRESSIONS: Record<TimeSeriesMetric, string> = {
  average_price: "toFloat64(avg(price))",
  transaction_count: "toFloat64(count())",
};

const PROPERTY_TYPE_CODES: Record<TimeSeriesPropertyType, string> = {
  terraced: "T",
  "semi-detached": "S",
  detached: "D",
  flat: "F",
  other: "O",
};

export type CompiledTimeSeriesQuery = {
  readonly strategy: QueryStrategy;
  readonly query: string;
  readonly queryParams: {
    readonly dateFrom: string;
    readonly dateTo: string;
    readonly locations: string[];
    readonly propertyTypes: string[];
  };
  readonly settings: {
    readonly optimize_move_to_prewhere: 0 | 1;
  };
};

export function compileTimeSeriesQuery(
  request: TimeSeriesRequest,
  strategy: QueryStrategy = "baseline",
): CompiledTimeSeriesQuery {
  const periodExpression = PERIOD_EXPRESSIONS[request.interval];
  const locationColumn = LOCATION_COLUMNS[request.location.level];
  const metricExpression = METRIC_EXPRESSIONS[request.metric];
  const propertyTypeFilter =
    request.propertyTypes.length === 0
      ? ""
      : "AND type IN {propertyTypes: Array(String)}";
  const filters = `
        date >= {dateFrom: Date}
        AND date <= {dateTo: Date}`;
  const filterClause =
    strategy === "prewhere"
      ? `PREWHERE ${filters}\n      WHERE ${locationColumn} IN {locations: Array(String)}`
      : `WHERE ${filters}\n        AND ${locationColumn} IN {locations: Array(String)}`;

  return {
    strategy,
    query: `
      SELECT
        ${periodExpression} AS period_start,
        toString(${locationColumn}) AS series,
        ${metricExpression} AS value,
        toUInt64(count()) AS observation_count
      FROM pp_complete
      ${filterClause}
        ${propertyTypeFilter}
      GROUP BY period_start, series
      ORDER BY period_start ASC, series ASC
      FORMAT ArrowStream
    `,
    queryParams: {
      dateFrom: request.dateFrom,
      dateTo: request.dateTo,
      locations: request.location.values.map((value) => value.toUpperCase()),
      propertyTypes: request.propertyTypes.map(
        (propertyType) => PROPERTY_TYPE_CODES[propertyType],
      ),
    },
    settings: {
      optimize_move_to_prewhere: strategy === "prewhere" ? 1 : 0,
    },
  };
}
