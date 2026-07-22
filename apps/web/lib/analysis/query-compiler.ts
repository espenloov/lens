import type { QueryStrategy } from "../query-arena/contracts";

import type {
  AggregateMetric,
  CategoricalDimension,
  CompactDimension,
  TimeInterval,
} from "./contracts";
import type {
  CategoricalRequest,
  ExecutableAnalysisRequest,
  ExecutableFilters,
  GrammarTimeSeriesRequest,
  HistogramRequest,
  MatrixRequest,
  ExplorationRequest,
} from "./execution";

const PERIOD_EXPRESSIONS: Record<TimeInterval, string> = {
  year: "toDate(toStartOfYear(date))",
  quarter: "toDate(toStartOfQuarter(date))",
  month: "toDate(toStartOfMonth(date))",
};

const PROPERTY_TYPE_EXPRESSION = `multiIf(
  type = 'detached', 'Detached',
  type = 'semi-detached', 'Semi-detached',
  type = 'terraced', 'Terraced',
  type = 'flat', 'Flat',
  'Other'
)`;

const TENURE_EXPRESSION = `multiIf(
  duration = 'freehold', 'Freehold',
  duration = 'leasehold', 'Leasehold',
  'Unknown'
)`;

const NEW_BUILD_EXPRESSION = "if(is_new = 1, 'New build', 'Existing')";

const EXPLORATION_DIMENSION_EXPRESSIONS: Record<CompactDimension, string> = {
  property_type: `multiIf(type = 'detached', 0, type = 'semi-detached', 1, type = 'terraced', 2, type = 'flat', 3, 4)`,
  tenure: `multiIf(duration = 'freehold', 0, duration = 'leasehold', 1, 2)`,
  new_build: "if(is_new = 1, 1, 0)",
};

const DIMENSION_EXPRESSIONS: Record<CategoricalDimension, string> = {
  town: "toString(town)",
  district: "toString(district)",
  county: "toString(county)",
  property_type: PROPERTY_TYPE_EXPRESSION,
  tenure: TENURE_EXPRESSION,
  new_build: NEW_BUILD_EXPRESSION,
};

const COMPACT_DIMENSION_ORDER: Record<CompactDimension, string> = {
  property_type: `multiIf(type = 'detached', 1, type = 'semi-detached', 2, type = 'terraced', 3, type = 'flat', 4, 5)`,
  tenure: `multiIf(duration = 'freehold', 1, duration = 'leasehold', 2, 3)`,
  new_build: "if(is_new = 1, 1, 2)",
};

const METRIC_EXPRESSIONS: Record<AggregateMetric, string> = {
  average_price: "toFloat64(round(avg(price)))",
  median_price: "toFloat64(round(quantileTDigest(0.5)(price)))",
  transaction_count: "toFloat64(count())",
};

export type AnalysisQueryParams = Record<
  string,
  string | number | string[] | number[]
>;

export type CompiledAnalysisQuery = {
  readonly shape: ExecutableAnalysisRequest["shape"];
  readonly query: string;
  readonly queryParams: AnalysisQueryParams;
  readonly settings: {
    readonly optimize_move_to_prewhere: 0 | 1;
    readonly max_result_rows: string;
    readonly max_rows_to_group_by: string;
  };
};

type CompiledFilters = {
  readonly sql: string;
  readonly params: AnalysisQueryParams;
};

function compileFilters(filters: ExecutableFilters): CompiledFilters {
  const clauses = [
    "date >= {dateFrom: Date}",
    "date <= {dateTo: Date}",
  ];
  const params: AnalysisQueryParams = {
    dateFrom: filters.dateFrom,
    dateTo: filters.dateTo,
  };

  if (filters.location !== null) {
    clauses.push(
      `${filters.location.level} IN {locations: Array(String)}`,
    );
    params.locations = filters.location.values;
  }

  if (filters.propertyTypes.length > 0) {
    clauses.push("type IN {propertyTypes: Array(String)}");
    params.propertyTypes = filters.propertyTypes;
  }

  if (filters.newBuild !== null) {
    clauses.push("is_new = {newBuild: UInt8}");
    params.newBuild = filters.newBuild ? 1 : 0;
  }

  if (filters.tenure.length > 0) {
    clauses.push("duration IN {tenure: Array(String)}");
    params.tenure = filters.tenure;
  }

  if (filters.minimumPrice !== null) {
    clauses.push("price >= {minimumPrice: UInt64}");
    params.minimumPrice = filters.minimumPrice;
  }

  if (filters.maximumPrice !== null) {
    clauses.push("price <= {maximumPrice: UInt64}");
    params.maximumPrice = filters.maximumPrice;
  }

  return {
    sql: clauses.join("\n        AND "),
    params,
  };
}

function compileTimeSeries(
  request: GrammarTimeSeriesRequest,
  strategy: QueryStrategy,
): CompiledAnalysisQuery {
  const filters = compileFilters(request.filters);
  const period = PERIOD_EXPRESSIONS[request.interval];
  const series =
    request.seriesBy === null
      ? "'All transactions'"
      : DIMENSION_EXPRESSIONS[request.seriesBy];
  const metric = METRIC_EXPRESSIONS[request.metric];
  const filterKeyword = strategy === "prewhere" ? "PREWHERE" : "WHERE";

  return {
    shape: "time_series",
    query: `
      SELECT
        ${period} AS period_start,
        toString(${series}) AS series,
        ${metric} AS value,
        toUInt64(count()) AS observation_count
      FROM pp_complete
      ${filterKeyword} ${filters.sql}
      GROUP BY period_start, series
      ORDER BY period_start ASC, series ASC
      FORMAT ArrowStream
    `,
    queryParams: filters.params,
    settings: {
      optimize_move_to_prewhere: strategy === "prewhere" ? 1 : 0,
      max_result_rows: "2000",
      max_rows_to_group_by: "2000",
    },
  };
}

function compileCategorical(
  request: CategoricalRequest,
): CompiledAnalysisQuery {
  const filters = compileFilters(request.filters);
  const dimension = DIMENSION_EXPRESSIONS[request.dimension];
  const metric = METRIC_EXPRESSIONS[request.metric];
  const direction = request.order === "ascending" ? "ASC" : "DESC";
  const minimumObservations =
    request.operation === "ranking" && request.metric !== "transaction_count"
      ? 20
      : 1;
  const having =
    request.operation === "ranking"
      ? "HAVING count() >= {minimumObservations: UInt64}"
      : "";

  return {
    shape: "categorical",
    query: `
      SELECT
        toString(${dimension}) AS category,
        ${metric} AS value,
        toUInt64(count()) AS observation_count
      FROM pp_complete
      WHERE ${filters.sql}
      GROUP BY category
      ${having}
      ORDER BY value ${direction}, category ASC
      LIMIT {limit: UInt64}
      FORMAT ArrowStream
    `,
    queryParams: {
      ...filters.params,
      limit: request.limit,
      ...(request.operation === "ranking" ? { minimumObservations } : {}),
    },
    settings: {
      optimize_move_to_prewhere: 1,
      max_result_rows: "50",
      max_rows_to_group_by: "100000",
    },
  };
}

function compileHistogram(request: HistogramRequest): CompiledAnalysisQuery {
  const filters = compileFilters(request.filters);
  const minimum = request.filters.minimumPrice ?? 0;
  const series =
    request.splitBy === null
      ? "'All transactions'"
      : DIMENSION_EXPRESSIONS[request.splitBy];

  return {
    shape: "histogram",
    query: `
      WITH least(
        intDiv(greatest(toInt64(price) - {histogramMinimum: Int64}, 0), {bucketWidth: UInt64}),
        {lastBin: UInt64}
      ) AS bin_index
      SELECT
        toFloat64({histogramMinimum: Int64} + bin_index * {bucketWidth: UInt64}) AS bin_start,
        toFloat64({histogramMinimum: Int64} + (bin_index + 1) * {bucketWidth: UInt64}) AS bin_end,
        toString(${series}) AS series,
        toFloat64(count()) AS value,
        toUInt64(count()) AS observation_count
      FROM pp_complete
      WHERE ${filters.sql}
      GROUP BY bin_index, series
      ORDER BY bin_index ASC, series ASC
      FORMAT ArrowStream
    `,
    queryParams: {
      ...filters.params,
      histogramMinimum: minimum,
      bucketWidth: request.bucketWidth,
      lastBin: request.maximumBins - 1,
    },
    settings: {
      optimize_move_to_prewhere: 1,
      max_result_rows: String(request.maximumBins * 5),
      max_rows_to_group_by: String(request.maximumBins * 5),
    },
  };
}

type MatrixDimension = MatrixRequest["xDimension"];

function matrixDimension(dimension: MatrixDimension): {
  readonly label: string;
  readonly order: string;
} {
  switch (dimension) {
    case "year":
      return {
        label: "toString(toYear(date))",
        order: "toInt32(toYear(date))",
      };
    case "quarter_of_year":
      return {
        label: "concat('Q', toString(toQuarter(date)))",
        order: "toInt32(toQuarter(date))",
      };
    case "month_of_year":
      return {
        label: "formatDateTime(date, '%b')",
        order: "toInt32(toMonth(date))",
      };
    case "property_type":
    case "tenure":
    case "new_build":
      return {
        label: DIMENSION_EXPRESSIONS[dimension],
        order: COMPACT_DIMENSION_ORDER[dimension],
      };
  }
}

function compileMatrix(request: MatrixRequest): CompiledAnalysisQuery {
  const filters = compileFilters(request.filters);
  const x = matrixDimension(request.xDimension);
  const y = matrixDimension(request.yDimension);
  const metric = METRIC_EXPRESSIONS[request.metric];

  return {
    shape: "matrix",
    query: `
      SELECT
        toString(${x.label}) AS x,
        toInt32(${x.order}) AS x_order,
        toString(${y.label}) AS y,
        toInt32(${y.order}) AS y_order,
        ${metric} AS value,
        toUInt64(count()) AS observation_count
      FROM pp_complete
      WHERE ${filters.sql}
      GROUP BY x, x_order, y, y_order
      ORDER BY x_order ASC, y_order ASC
      FORMAT ArrowStream
    `,
    queryParams: filters.params,
    settings: {
      optimize_move_to_prewhere: 1,
      max_result_rows: "1600",
      max_rows_to_group_by: "1600",
    },
  };
}

function explorationDimension(
  request: ExplorationRequest,
  index: number,
): string {
  const dimension = request.dimensions[index];

  return dimension === undefined
    ? "toUInt8(0)"
    : `toUInt8(${EXPLORATION_DIMENSION_EXPRESSIONS[dimension]})`;
}

function compileExploration(
  request: ExplorationRequest,
): CompiledAnalysisQuery {
  const filters = compileFilters(request.filters);

  return {
    shape: "exploration",
    query: `
      SELECT
        toUInt16(dateDiff('day', {dateFrom: Date}, date)) AS day_index,
        toFloat64(price) AS value,
        ${explorationDimension(request, 0)} AS dimension_0,
        ${explorationDimension(request, 1)} AS dimension_1,
        ${explorationDimension(request, 2)} AS dimension_2
      FROM pp_complete
      PREWHERE ${filters.sql}
      LIMIT {explorationSentinel: UInt64}
      FORMAT ArrowStream
    `,
    queryParams: {
      ...filters.params,
      explorationSentinel: request.rowLimit + 1,
    },
    settings: {
      optimize_move_to_prewhere: 1,
      max_result_rows: String(request.rowLimit + 1),
      max_rows_to_group_by: "1",
    },
  };
}

export function compileExplorationCountQuery(request: ExplorationRequest): {
  readonly query: string;
  readonly queryParams: AnalysisQueryParams;
} {
  const filters = compileFilters(request.filters);

  return {
    query: `
      SELECT toUInt64(count()) AS row_count
      FROM pp_complete
      PREWHERE ${filters.sql}
    `,
    queryParams: filters.params,
  };
}

export function compileAnalysisQuery(
  request: ExecutableAnalysisRequest,
  strategy: QueryStrategy = "baseline",
): CompiledAnalysisQuery {
  switch (request.shape) {
    case "time_series":
      return compileTimeSeries(request, strategy);
    case "categorical":
      return compileCategorical(request);
    case "histogram":
      return compileHistogram(request);
    case "matrix":
      return compileMatrix(request);
    case "exploration":
      return compileExploration(request);
  }
}
