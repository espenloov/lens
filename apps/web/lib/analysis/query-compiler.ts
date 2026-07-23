import type { QueryStrategy } from "../query-arena/contracts";
import { PROPERTY_TRANSACTION_MANIFEST } from "../data-sources/property-manifest";
import {
  compileMeasureAggregation,
  findAnalyticalDimension,
  findAnalyticalMeasure,
  type AnalyticalDimension,
  type AnalyticalTableManifest,
} from "../data-sources/semantic";

import type {
  AggregateMetric,
  TimeInterval,
} from "./contracts";
import {
  validateSemanticAnalysisPlan,
  type SemanticAnalysisPlan,
  type SemanticFilters,
  type SemanticMetricReference,
} from "./semantic-plan";
import type {
  CategoricalRequest,
  ExecutableAnalysisRequest,
  ExecutableFilters,
  GrammarTimeSeriesRequest,
  HistogramRequest,
  MatrixRequest,
  ExplorationRequest,
} from "./execution";

const LEGACY_METRIC_REFERENCES: Record<
  AggregateMetric,
  SemanticMetricReference
> = {
  average_price: {
    kind: "measure",
    measure: "price",
    aggregation: "average",
  },
  median_price: {
    kind: "measure",
    measure: "price",
    aggregation: "median",
  },
  transaction_count: {
    kind: "row_count",
  },
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

export type AnalysisQuerySource = {
  readonly fromClause: string;
  readonly supportsPrewhere: boolean;
  readonly manifest?: AnalyticalTableManifest;
};

export const BUILTIN_QUERY_SOURCE: AnalysisQuerySource = {
  fromClause: "pp_complete",
  supportsPrewhere: true,
  manifest: PROPERTY_TRANSACTION_MANIFEST,
};

type CompiledFilters = {
  readonly sql: string;
  readonly params: AnalysisQueryParams;
};

function sourceManifest(source: AnalysisQuerySource): AnalyticalTableManifest {
  return source.manifest ?? PROPERTY_TRANSACTION_MANIFEST;
}

function requireTime(manifest: AnalyticalTableManifest) {
  if (manifest.time === null) {
    throw new Error("The analytical source does not declare a time field");
  }

  return manifest.time;
}

function requireMeasure(manifest: AnalyticalTableManifest, key: string) {
  const measure = findAnalyticalMeasure(manifest, key);

  if (measure === null) {
    throw new Error(`The analytical source does not declare measure ${key}`);
  }

  return measure;
}

function requireDimension(
  manifest: AnalyticalTableManifest,
  key: string,
): AnalyticalDimension {
  const dimension = findAnalyticalDimension(manifest, key);

  if (dimension === null) {
    throw new Error(`The analytical source does not declare dimension ${key}`);
  }

  return dimension;
}

export function compileSemanticMetric(
  manifest: AnalyticalTableManifest,
  reference: SemanticMetricReference,
): string {
  return reference.kind === "row_count"
    ? "toFloat64(count())"
    : compileMeasureAggregation(
        requireMeasure(manifest, reference.measure),
        reference.aggregation,
      );
}

function metricExpression(
  manifest: AnalyticalTableManifest,
  metric: AggregateMetric,
): string {
  return compileSemanticMetric(manifest, LEGACY_METRIC_REFERENCES[metric]);
}

function periodExpression(
  manifest: AnalyticalTableManifest,
  interval: TimeInterval,
): string {
  const time = requireTime(manifest);

  if (!time.granularities.includes(interval)) {
    throw new Error(
      `The analytical source does not support ${interval} time buckets`,
    );
  }

  switch (interval) {
    case "year":
      return `toDate(toStartOfYear(${time.expression}))`;
    case "quarter":
      return `toDate(toStartOfQuarter(${time.expression}))`;
    case "month":
      return `toDate(toStartOfMonth(${time.expression}))`;
  }
}

function compileFilters(
  filters: ExecutableFilters,
  manifest: AnalyticalTableManifest,
): CompiledFilters {
  const time = requireTime(manifest);
  const clauses = [
    `${time.expression} >= {dateFrom: Date}`,
    `${time.expression} <= {dateTo: Date}`,
  ];
  const params: AnalysisQueryParams = {
    dateFrom: filters.dateFrom,
    dateTo: filters.dateTo,
  };

  if (filters.location !== null) {
    const location = requireDimension(manifest, filters.location.level);
    clauses.push(
      `${location.filterExpression} IN {locations: Array(String)}`,
    );
    params.locations = filters.location.values;
  }

  if (filters.propertyTypes.length > 0) {
    const propertyType = requireDimension(manifest, "property_type");
    clauses.push(
      `${propertyType.filterExpression} IN {propertyTypes: Array(String)}`,
    );
    params.propertyTypes = filters.propertyTypes;
  }

  if (filters.newBuild !== null) {
    const newBuild = requireDimension(manifest, "new_build");
    clauses.push(`${newBuild.filterExpression} = {newBuild: UInt8}`);
    params.newBuild = filters.newBuild ? 1 : 0;
  }

  if (filters.tenure.length > 0) {
    const tenure = requireDimension(manifest, "tenure");
    clauses.push(`${tenure.filterExpression} IN {tenure: Array(String)}`);
    params.tenure = filters.tenure;
  }

  if (filters.minimumPrice !== null) {
    const price = requireMeasure(manifest, "price");
    clauses.push(`${price.expression} >= {minimumPrice: UInt64}`);
    params.minimumPrice = filters.minimumPrice;
  }

  if (filters.maximumPrice !== null) {
    const price = requireMeasure(manifest, "price");
    clauses.push(`${price.expression} <= {maximumPrice: UInt64}`);
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
  source: AnalysisQuerySource,
): CompiledAnalysisQuery {
  const manifest = sourceManifest(source);
  const filters = compileFilters(request.filters, manifest);
  const period = periodExpression(manifest, request.interval);
  const series =
    request.seriesBy === null
      ? "'All transactions'"
      : requireDimension(manifest, request.seriesBy).expression;
  const metric = metricExpression(manifest, request.metric);
  const usePrewhere = strategy === "prewhere" && source.supportsPrewhere;
  const filterKeyword = usePrewhere ? "PREWHERE" : "WHERE";

  return {
    shape: "time_series",
    query: `
      SELECT
        ${period} AS period_start,
        toString(${series}) AS series,
        ${metric} AS value,
        toUInt64(count()) AS observation_count
      FROM ${source.fromClause}
      ${filterKeyword} ${filters.sql}
      GROUP BY period_start, series
      ORDER BY period_start ASC, series ASC
      FORMAT ArrowStream
    `,
    queryParams: filters.params,
    settings: {
      optimize_move_to_prewhere: usePrewhere ? 1 : 0,
      max_result_rows: "2000",
      max_rows_to_group_by: "2000",
    },
  };
}

function compileCategorical(
  request: CategoricalRequest,
  source: AnalysisQuerySource,
): CompiledAnalysisQuery {
  const manifest = sourceManifest(source);
  const filters = compileFilters(request.filters, manifest);
  const dimension = requireDimension(
    manifest,
    request.dimension,
  ).expression;
  const metric = metricExpression(manifest, request.metric);
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
      FROM ${source.fromClause}
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
      optimize_move_to_prewhere: source.supportsPrewhere ? 1 : 0,
      max_result_rows: "50",
      max_rows_to_group_by: "100000",
    },
  };
}

function compileHistogram(
  request: HistogramRequest,
  source: AnalysisQuerySource,
): CompiledAnalysisQuery {
  const manifest = sourceManifest(source);
  const filters = compileFilters(request.filters, manifest);
  const valueMeasure = requireMeasure(manifest, request.field);
  const minimum = request.filters.minimumPrice ?? 0;
  const series =
    request.splitBy === null
      ? "'All transactions'"
      : requireDimension(manifest, request.splitBy).expression;

  if (!valueMeasure.supportsDistribution) {
    throw new Error(
      `Measure ${valueMeasure.key} does not support distributions`,
    );
  }

  return {
    shape: "histogram",
    query: `
      WITH least(
        intDiv(greatest(toInt64(${valueMeasure.expression}) - {histogramMinimum: Int64}, 0), {bucketWidth: UInt64}),
        {lastBin: UInt64}
      ) AS bin_index
      SELECT
        toFloat64({histogramMinimum: Int64} + bin_index * {bucketWidth: UInt64}) AS bin_start,
        toFloat64({histogramMinimum: Int64} + (bin_index + 1) * {bucketWidth: UInt64}) AS bin_end,
        toString(${series}) AS series,
        toFloat64(count()) AS value,
        toUInt64(count()) AS observation_count
      FROM ${source.fromClause}
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
      optimize_move_to_prewhere: source.supportsPrewhere ? 1 : 0,
      max_result_rows: String(request.maximumBins * 5),
      max_rows_to_group_by: String(request.maximumBins * 5),
    },
  };
}

type MatrixDimension = MatrixRequest["xDimension"];

function matrixDimension(
  dimension: MatrixDimension,
  manifest: AnalyticalTableManifest,
): {
  readonly label: string;
  readonly order: string;
} {
  const time = requireTime(manifest);

  switch (dimension) {
    case "year":
      return {
        label: `toString(toYear(${time.expression}))`,
        order: `toInt32(toYear(${time.expression}))`,
      };
    case "quarter_of_year":
      return {
        label: `concat('Q', toString(toQuarter(${time.expression})))`,
        order: `toInt32(toQuarter(${time.expression}))`,
      };
    case "month_of_year":
      return {
        label: `formatDateTime(${time.expression}, '%b')`,
        order: `toInt32(toMonth(${time.expression}))`,
      };
    case "property_type":
    case "tenure":
    case "new_build": {
      const resolved = requireDimension(manifest, dimension);

      if (resolved.orderExpression === null) {
        throw new Error(
          `Dimension ${dimension} does not declare a stable matrix order`,
        );
      }

      return {
        label: resolved.expression,
        order: resolved.orderExpression,
      };
    }
  }
}

function compileMatrix(
  request: MatrixRequest,
  source: AnalysisQuerySource,
): CompiledAnalysisQuery {
  const manifest = sourceManifest(source);
  const filters = compileFilters(request.filters, manifest);
  const x = matrixDimension(request.xDimension, manifest);
  const y = matrixDimension(request.yDimension, manifest);
  const metric = metricExpression(manifest, request.metric);

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
      FROM ${source.fromClause}
      WHERE ${filters.sql}
      GROUP BY x, x_order, y, y_order
      ORDER BY x_order ASC, y_order ASC
      FORMAT ArrowStream
    `,
    queryParams: filters.params,
    settings: {
      optimize_move_to_prewhere: source.supportsPrewhere ? 1 : 0,
      max_result_rows: "1600",
      max_rows_to_group_by: "1600",
    },
  };
}

function explorationDimension(
  request: ExplorationRequest,
  index: number,
  manifest: AnalyticalTableManifest,
): string {
  const dimension = request.dimensions[index];

  if (dimension === undefined) {
    return "toUInt8(0)";
  }

  const resolved = requireDimension(manifest, dimension);

  if (!resolved.compact || resolved.codeExpression === null) {
    throw new Error(
      `Dimension ${dimension} cannot be encoded for local exploration`,
    );
  }

  return `toUInt8(${resolved.codeExpression})`;
}

function compileExploration(
  request: ExplorationRequest,
  source: AnalysisQuerySource,
): CompiledAnalysisQuery {
  const manifest = sourceManifest(source);
  const filters = compileFilters(request.filters, manifest);
  const time = requireTime(manifest);
  const valueMeasure = requireMeasure(manifest, request.valueField);
  const filterKeyword = source.supportsPrewhere ? "PREWHERE" : "WHERE";

  if (!valueMeasure.supportsDistribution) {
    throw new Error(
      `Measure ${valueMeasure.key} cannot back an exploration workspace`,
    );
  }

  return {
    shape: "exploration",
    query: `
      SELECT
        toUInt16(dateDiff('day', {dateFrom: Date}, ${time.expression})) AS day_index,
        toFloat64(${valueMeasure.expression}) AS value,
        ${explorationDimension(request, 0, manifest)} AS dimension_0,
        ${explorationDimension(request, 1, manifest)} AS dimension_1,
        ${explorationDimension(request, 2, manifest)} AS dimension_2
      FROM ${source.fromClause}
      ${filterKeyword} ${filters.sql}
      LIMIT {explorationSentinel: UInt64}
      FORMAT ArrowStream
    `,
    queryParams: {
      ...filters.params,
      explorationSentinel: request.rowLimit + 1,
    },
    settings: {
      optimize_move_to_prewhere: source.supportsPrewhere ? 1 : 0,
      max_result_rows: String(request.rowLimit + 1),
      max_rows_to_group_by: "1",
    },
  };
}

export function compileExplorationCountQuery(
  request: ExplorationRequest,
  source: AnalysisQuerySource = BUILTIN_QUERY_SOURCE,
): {
  readonly query: string;
  readonly queryParams: AnalysisQueryParams;
} {
  const filters = compileFilters(request.filters, sourceManifest(source));

  return {
    query: `
      SELECT toUInt64(count()) AS row_count
      FROM ${source.fromClause}
      ${source.supportsPrewhere ? "PREWHERE" : "WHERE"} ${filters.sql}
    `,
    queryParams: filters.params,
  };
}

export function compileAnalysisQuery(
  request: ExecutableAnalysisRequest,
  strategy: QueryStrategy = "baseline",
  source: AnalysisQuerySource = BUILTIN_QUERY_SOURCE,
): CompiledAnalysisQuery {
  switch (request.shape) {
    case "time_series":
      return compileTimeSeries(request, strategy, source);
    case "categorical":
      return compileCategorical(request, source);
    case "histogram":
      return compileHistogram(request, source);
    case "matrix":
      return compileMatrix(request, source);
    case "exploration":
      return compileExploration(request, source);
  }
}

function semanticFilterValue(value: string | number | boolean): string {
  return typeof value === "boolean" ? (value ? "1" : "0") : String(value);
}

function compileSemanticFilters(
  filters: SemanticFilters,
  manifest: AnalyticalTableManifest,
): CompiledFilters {
  const clauses: string[] = [];
  const params: AnalysisQueryParams = {};

  if (filters.timeRange !== null) {
    const time = requireTime(manifest);
    clauses.push(`${time.expression} >= {semanticDateFrom: Date}`);
    clauses.push(
      time.storageType === "datetime"
        ? `${time.expression} < addDays({semanticDateTo: Date}, 1)`
        : `${time.expression} <= {semanticDateTo: Date}`,
    );
    params.semanticDateFrom = filters.timeRange.from;
    params.semanticDateTo = filters.timeRange.to;
  }

  filters.dimensions.forEach((filter, index) => {
    const dimension = requireDimension(manifest, filter.dimension);
    const parameter = `semanticDimension${index}`;
    clauses.push(
      `toString(${dimension.filterExpression}) IN {${parameter}: Array(String)}`,
    );
    params[parameter] = filter.values.map(semanticFilterValue);
  });

  filters.measures.forEach((filter, index) => {
    const measure = requireMeasure(manifest, filter.measure);

    if (filter.minimum !== null) {
      const parameter = `semanticMinimum${index}`;
      clauses.push(`${measure.expression} >= {${parameter}: Float64}`);
      params[parameter] = filter.minimum;
    }

    if (filter.maximum !== null) {
      const parameter = `semanticMaximum${index}`;
      clauses.push(`${measure.expression} <= {${parameter}: Float64}`);
      params[parameter] = filter.maximum;
    }
  });

  return {
    sql: clauses.length === 0 ? "1" : clauses.join("\n        AND "),
    params,
  };
}

function compileSemanticTimeSeries(
  plan: Extract<
    SemanticAnalysisPlan,
    { operation: "trend" | "comparison" | "composition" | "anomaly" }
  >,
  source: AnalysisQuerySource,
  strategy: QueryStrategy,
): CompiledAnalysisQuery {
  const manifest = sourceManifest(source);
  const filters = compileSemanticFilters(plan.filters, manifest);
  const interval = plan.interval;

  if (interval === null) {
    throw new Error("Time-series analysis requires a time interval");
  }

  const period = periodExpression(manifest, interval);
  const seriesKey =
    plan.operation === "comparison"
      ? plan.compareBy
      : plan.operation === "composition"
        ? plan.dimension
        : plan.splitBy;
  const series =
    seriesKey === null
      ? "'All rows'"
      : requireDimension(manifest, seriesKey).expression;
  const metric =
    plan.operation === "composition"
      ? compileSemanticMetric(manifest, { kind: "row_count" })
      : compileSemanticMetric(manifest, plan.metric);
  const optimized = strategy === "prewhere";
  const filterKeyword =
    optimized && source.supportsPrewhere ? "PREWHERE" : "WHERE";

  return {
    shape: "time_series",
    query: `
      SELECT
        ${period} AS period_start,
        toString(${series}) AS series,
        ${metric} AS value,
        toUInt64(count()) AS observation_count
      FROM ${source.fromClause}
      ${filterKeyword} ${filters.sql}
      GROUP BY period_start, series
      ORDER BY period_start ASC, series ASC
      FORMAT ArrowStream
    `,
    queryParams: filters.params,
    settings: {
      optimize_move_to_prewhere: optimized ? 1 : 0,
      max_result_rows: "5000",
      max_rows_to_group_by: "5000",
    },
  };
}

function compileSemanticCategorical(
  plan: Extract<
    SemanticAnalysisPlan,
    { operation: "comparison" | "ranking" | "composition" }
  >,
  source: AnalysisQuerySource,
): CompiledAnalysisQuery {
  const manifest = sourceManifest(source);
  const filters = compileSemanticFilters(plan.filters, manifest);
  const dimensionKey =
    plan.operation === "comparison"
      ? plan.compareBy
      : plan.operation === "ranking"
        ? plan.rankBy
        : plan.dimension;
  const dimension = requireDimension(manifest, dimensionKey);
  const metric =
    plan.operation === "composition"
      ? compileSemanticMetric(manifest, { kind: "row_count" })
      : compileSemanticMetric(manifest, plan.metric);
  const order = plan.operation === "ranking" ? plan.order : "descending";
  const limit = plan.operation === "ranking" ? plan.limit : 50;

  return {
    shape: "categorical",
    query: `
      SELECT
        toString(${dimension.expression}) AS category,
        ${metric} AS value,
        toUInt64(count()) AS observation_count
      FROM ${source.fromClause}
      WHERE ${filters.sql}
      GROUP BY category
      ORDER BY value ${order === "ascending" ? "ASC" : "DESC"}, category ASC
      LIMIT {semanticLimit: UInt64}
      FORMAT ArrowStream
    `,
    queryParams: {
      ...filters.params,
      semanticLimit: limit,
    },
    settings: {
      optimize_move_to_prewhere: source.supportsPrewhere ? 1 : 0,
      max_result_rows: "50",
      max_rows_to_group_by: "100000",
    },
  };
}

function compileSemanticDistribution(
  plan: Extract<SemanticAnalysisPlan, { operation: "distribution" }>,
  source: AnalysisQuerySource,
): CompiledAnalysisQuery {
  const manifest = sourceManifest(source);
  const filters = compileSemanticFilters(plan.filters, manifest);
  const measure = requireMeasure(manifest, plan.measure);
  const series =
    plan.splitBy === null
      ? "'All rows'"
      : requireDimension(manifest, plan.splitBy).expression;
  const minimum = plan.bucketMinimum;

  return {
    shape: "histogram",
    query: `
      WITH least(
        toUInt64(floor(
          greatest(toFloat64(${measure.expression}) - {semanticHistogramMinimum: Float64}, 0)
          / {semanticBucketWidth: Float64}
        )),
        {semanticLastBin: UInt64}
      ) AS bin_index
      SELECT
        toFloat64({semanticHistogramMinimum: Float64} + bin_index * {semanticBucketWidth: Float64}) AS bin_start,
        toFloat64({semanticHistogramMinimum: Float64} + (bin_index + 1) * {semanticBucketWidth: Float64}) AS bin_end,
        toString(${series}) AS series,
        toFloat64(count()) AS value,
        toUInt64(count()) AS observation_count
      FROM ${source.fromClause}
      WHERE ${filters.sql}
      GROUP BY bin_index, series
      ORDER BY bin_index ASC, series ASC
      FORMAT ArrowStream
    `,
    queryParams: {
      ...filters.params,
      semanticHistogramMinimum: minimum,
      semanticBucketWidth: plan.bucketWidth,
      semanticLastBin: plan.maximumBins - 1,
    },
    settings: {
      optimize_move_to_prewhere: source.supportsPrewhere ? 1 : 0,
      max_result_rows: String(plan.maximumBins * 50),
      max_rows_to_group_by: String(plan.maximumBins * 50),
    },
  };
}

export function compileSemanticAnalysisQuery(
  plan: SemanticAnalysisPlan,
  source: AnalysisQuerySource,
  strategy: QueryStrategy = "baseline",
): CompiledAnalysisQuery {
  const validated = validateSemanticAnalysisPlan(
    plan,
    sourceManifest(source),
  );

  if (validated.isErr()) {
    throw new Error(validated.error.message);
  }

  switch (plan.operation) {
    case "trend":
    case "anomaly":
      return compileSemanticTimeSeries(plan, source, strategy);
    case "comparison":
      return plan.interval === null
        ? compileSemanticCategorical(plan, source)
        : compileSemanticTimeSeries(plan, source, strategy);
    case "ranking":
      return compileSemanticCategorical(plan, source);
    case "composition":
      return plan.interval === null
        ? compileSemanticCategorical(plan, source)
        : compileSemanticTimeSeries(plan, source, strategy);
    case "distribution":
      return compileSemanticDistribution(plan, source);
  }
}
