import { describe, expect, it } from "vitest";

import { compileAnalysisQuery } from "../analysis/query-compiler";
import {
  categoricalRequestSchema,
  explorationRequestSchema,
  histogramRequestSchema,
  matrixRequestSchema,
  timeSeriesRequestSchema,
} from "../analysis/execution";

const filters = {
  dateFrom: "2018-01-01",
  dateTo: "2023-12-31",
  location: {
    level: "town" as const,
    values: ["MANCHESTER", "LIVERPOOL"],
  },
  propertyTypes: [],
  newBuild: null,
  tenure: [],
  minimumPrice: null,
  maximumPrice: null,
};

describe("compileAnalysisQuery", () => {
  it("compiles a median trend into the stable time-series Arrow contract", () => {
    const request = timeSeriesRequestSchema.parse({
      shape: "time_series",
      operation: "trend",
      metric: "median_price",
      interval: "quarter",
      seriesBy: "town",
      transform: "value",
      anomalyThreshold: null,
      filters,
    });
    const compiled = compileAnalysisQuery(request);

    expect(compiled.query).toContain(
      "toDate(toStartOfQuarter(date)) AS period_start",
    );
    expect(compiled.query).toContain(
      "quantileTDigest(0.5)(price)",
    );
    expect(compiled.query).not.toContain("MANCHESTER");
    expect(compiled.queryParams.locations).toEqual([
      "MANCHESTER",
      "LIVERPOOL",
    ]);
  });

  it("binds injection-shaped values instead of interpolating them", () => {
    const injection = "MANCHESTER') OR 1=1 --";
    const request = timeSeriesRequestSchema.parse({
      shape: "time_series",
      operation: "comparison",
      metric: "average_price",
      interval: "year",
      seriesBy: "town",
      transform: "value",
      anomalyThreshold: null,
      filters: {
        ...filters,
        location: { level: "town", values: [injection] },
      },
    });
    const compiled = compileAnalysisQuery(request);

    expect(compiled.query).not.toContain(injection);
    expect(compiled.queryParams.locations).toEqual([injection]);
  });

  it("uses the live Enum labels for property and tenure filters", () => {
    const request = timeSeriesRequestSchema.parse({
      shape: "time_series",
      operation: "trend",
      metric: "transaction_count",
      interval: "year",
      seriesBy: "property_type",
      transform: "value",
      anomalyThreshold: null,
      filters: {
        ...filters,
        propertyTypes: ["detached", "flat"],
        tenure: ["freehold"],
      },
    });
    const compiled = compileAnalysisQuery(request);

    expect(compiled.query).toContain("type = 'detached'");
    expect(compiled.query).toContain("duration IN {tenure: Array(String)}");
    expect(compiled.queryParams.propertyTypes).toEqual(["detached", "flat"]);
    expect(compiled.queryParams.tenure).toEqual(["freehold"]);
  });

  it("compiles deterministic bounded category rankings", () => {
    const request = categoricalRequestSchema.parse({
      shape: "categorical",
      operation: "ranking",
      metric: "transaction_count",
      dimension: "county",
      transform: "value",
      order: "descending",
      limit: 12,
      filters: { ...filters, location: null },
    });
    const compiled = compileAnalysisQuery(request);

    expect(compiled.query).toContain("ORDER BY value DESC, category ASC");
    expect(compiled.query).toContain("LIMIT {limit: UInt64}");
    expect(compiled.queryParams.limit).toBe(12);
    expect(compiled.queryParams.minimumObservations).toBe(1);
  });

  it("compiles clamped fixed-width histogram bins", () => {
    const request = histogramRequestSchema.parse({
      shape: "histogram",
      operation: "distribution",
      field: "price",
      splitBy: "property_type",
      bucketWidth: 50_000,
      maximumBins: 30,
      filters,
    });
    const compiled = compileAnalysisQuery(request);

    expect(compiled.query).toContain("intDiv");
    expect(compiled.query).toContain("least(");
    expect(compiled.queryParams.lastBin).toBe(29);
    expect(compiled.settings.max_result_rows).toBe("150");
  });

  it("compiles a bounded sparse heatmap", () => {
    const request = matrixRequestSchema.parse({
      shape: "matrix",
      operation: "heatmap",
      metric: "average_price",
      xDimension: "year",
      yDimension: "property_type",
      filters,
    });
    const compiled = compileAnalysisQuery(request);

    expect(compiled.query).toContain("AS x_order");
    expect(compiled.query).toContain("AS y_order");
    expect(compiled.query).toContain("GROUP BY x, x_order, y, y_order");
    expect(compiled.settings.max_rows_to_group_by).toBe("1600");
  });

  it("compiles compact raw exploration columns without string categories", () => {
    const request = explorationRequestSchema.parse({
      shape: "exploration",
      operation: "exploration",
      valueField: "price",
      dimensions: ["property_type", "tenure", "new_build"],
      bucketMinimum: 0,
      bucketWidth: 50_000,
      binCount: 64,
      rowLimit: 1_000_000,
      filters: {
        ...filters,
        dateFrom: "2022-01-01",
        dateTo: "2022-12-31",
        location: null,
      },
    });
    const compiled = compileAnalysisQuery(request);

    expect(compiled.query).toContain("AS day_index");
    expect(compiled.query).toContain("AS dimension_2");
    expect(compiled.query).toContain("LIMIT {explorationSentinel: UInt64}");
    expect(compiled.query).not.toContain("Detached");
    expect(compiled.queryParams.explorationSentinel).toBe(1_000_001);
  });
});
