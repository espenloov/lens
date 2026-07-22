import { describe, expect, it } from "vitest";

import { analysisPlanSchema, type AnalysisPlan } from "./contracts";
import { executableAnalysisRequestSchema } from "./execution";
import { prepareAnalysis, toExecutableAnalysis } from "./prepare-analysis";

const filters = {
  dateFrom: "2015-01-01",
  dateTo: "2023-12-31",
  location: {
    level: "town" as const,
    values: ["Manchester", "Liverpool"],
  },
  propertyTypes: [],
  newBuild: null,
  tenure: [],
  minimumPrice: null,
  maximumPrice: null,
};

const trend: AnalysisPlan = {
  version: 1,
  dataset: "uk_price_paid",
  operation: "trend",
  title: "Manchester and Liverpool prices",
  explanation: "Compare yearly prices in both cities.",
  metric: "average_price",
  interval: "year",
  splitBy: "town",
  transform: "value",
  filters,
};

describe("analysisPlanSchema", () => {
  it("makes operation-specific fields mandatory", () => {
    const malformed = analysisPlanSchema.safeParse({
      ...trend,
      operation: "ranking",
    });

    expect(malformed.success).toBe(false);
  });

  it("rejects identical heatmap axes", () => {
    const malformed = analysisPlanSchema.safeParse({
      version: 1,
      dataset: "uk_price_paid",
      operation: "heatmap",
      title: "Invalid heatmap",
      explanation: "The same dimension cannot form both axes.",
      metric: "transaction_count",
      xDimension: "year",
      yDimension: "year",
      filters,
    });

    expect(malformed.success).toBe(false);
  });

  it("requires unique local exploration dimensions", () => {
    const malformed = analysisPlanSchema.safeParse({
      version: 1,
      dataset: "uk_price_paid",
      operation: "exploration",
      title: "Repeated dimensions",
      explanation: "The same local dimension cannot be loaded twice.",
      valueField: "price",
      dimensions: ["property_type", "property_type"],
      filters,
    });

    expect(malformed.success).toBe(false);
  });
});

describe("executableAnalysisRequestSchema", () => {
  it("rejects cross-operation transform combinations", () => {
    const parsed = executableAnalysisRequestSchema.safeParse({
      shape: "time_series",
      operation: "trend",
      metric: "average_price",
      interval: "year",
      seriesBy: null,
      transform: "anomaly_score",
      anomalyThreshold: 3.5,
      filters,
    });

    expect(parsed.success).toBe(false);
  });

  it("rejects non-additive or high-cardinality compositions", () => {
    const parsed = executableAnalysisRequestSchema.safeParse({
      shape: "categorical",
      operation: "composition",
      metric: "average_price",
      dimension: "town",
      transform: "share",
      order: "descending",
      limit: 10,
      filters,
    });

    expect(parsed.success).toBe(false);
  });

  it("rejects unbounded geographical time series", () => {
    const parsed = executableAnalysisRequestSchema.safeParse({
      shape: "time_series",
      operation: "comparison",
      metric: "transaction_count",
      interval: "month",
      seriesBy: "town",
      transform: "value",
      anomalyThreshold: null,
      filters: { ...filters, location: null },
    });

    expect(parsed.success).toBe(false);
  });

  it("rejects reversed executable price ranges", () => {
    const parsed = executableAnalysisRequestSchema.safeParse({
      shape: "categorical",
      operation: "ranking",
      metric: "transaction_count",
      dimension: "county",
      transform: "value",
      order: "descending",
      limit: 10,
      filters: { ...filters, minimumPrice: 500_000, maximumPrice: 100_000 },
    });

    expect(parsed.success).toBe(false);
  });

  it("rejects direct exploration requests longer than one year", () => {
    const parsed = executableAnalysisRequestSchema.safeParse({
      shape: "exploration",
      operation: "exploration",
      valueField: "price",
      dimensions: ["property_type", "tenure", "new_build"],
      bucketMinimum: 0,
      bucketWidth: 50_000,
      binCount: 64,
      rowLimit: 1_000_000,
      filters: { ...filters, dateFrom: "2022-01-01" },
    });

    expect(parsed.success).toBe(false);
  });
});

describe("toExecutableAnalysis", () => {
  it("normalizes a trend into a strict time-series request", () => {
    const result = toExecutableAnalysis(trend);

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toMatchObject({
      shape: "time_series",
      seriesBy: "town",
      filters: {
        location: { values: ["MANCHESTER", "LIVERPOOL"] },
      },
    });
  });

  it("routes every supported operation to a deterministic shape", () => {
    const plans: AnalysisPlan[] = [
      {
        ...trend,
        operation: "comparison",
        compareBy: "property_type",
        interval: null,
      },
      {
        ...trend,
        operation: "ranking",
        rankBy: "county",
        order: "descending",
        limit: 10,
      },
      {
        version: 1,
        dataset: "uk_price_paid",
        operation: "distribution",
        title: "Price distribution",
        explanation: "A deterministic price histogram.",
        field: "price",
        splitBy: "property_type",
        binning: { width: 50_000, maximumBins: 30 },
        filters,
      },
      {
        version: 1,
        dataset: "uk_price_paid",
        operation: "composition",
        title: "Property mix",
        explanation: "The property mix over time.",
        dimension: "property_type",
        interval: "year",
        filters,
      },
      {
        version: 1,
        dataset: "uk_price_paid",
        operation: "heatmap",
        title: "Year and property type",
        explanation: "Transaction volume by year and property type.",
        metric: "transaction_count",
        xDimension: "year",
        yDimension: "property_type",
        filters,
      },
      {
        version: 1,
        dataset: "uk_price_paid",
        operation: "exploration",
        title: "Local workspace",
        explanation: "Explore every selected transaction locally.",
        valueField: "price",
        dimensions: ["property_type", "tenure", "new_build"],
        filters: {
          ...filters,
          dateFrom: "2022-01-01",
          dateTo: "2022-12-31",
        },
      },
    ];

    expect(plans.map((plan) => toExecutableAnalysis(plan)._unsafeUnwrap().shape)).toEqual([
      "categorical",
      "categorical",
      "histogram",
      "time_series",
      "matrix",
      "exploration",
    ]);
  });

  it("injects trusted exploration budgets", () => {
    const result = toExecutableAnalysis({
      version: 1,
      dataset: "uk_price_paid",
      operation: "exploration",
      title: "Local workspace",
      explanation: "Explore a complete year locally.",
      valueField: "price",
      dimensions: ["property_type", "tenure", "new_build"],
      filters: {
        ...filters,
        dateFrom: "2022-01-01",
        dateTo: "2022-12-31",
      },
    });

    expect(result._unsafeUnwrap()).toMatchObject({
      shape: "exploration",
      bucketWidth: 50_000,
      binCount: 64,
      rowLimit: 1_000_000,
    });
  });

  it("rejects unbounded high-cardinality trend series", () => {
    const result = toExecutableAnalysis({
      ...trend,
      splitBy: "district",
      filters: { ...filters, location: null },
    });

    expect(result.isErr()).toBe(true);
  });

  it("requires enough history for robust anomalies", () => {
    const result = toExecutableAnalysis({
      ...trend,
      operation: "anomaly",
      interval: "month",
      splitBy: null,
      sensitivity: "normal",
      filters: { ...filters, dateFrom: "2021-01-01" },
    });

    expect(result.isErr()).toBe(true);
  });
});

describe("prepareAnalysis", () => {
  it("returns expected failures as typed application data", () => {
    const result = prepareAnalysis({
      ...trend,
      splitBy: "county",
      filters: { ...filters, location: null },
    });

    expect(result).toMatchObject({
      status: "unsupported",
      error: { type: "unsupported_analysis_plan" },
    });
  });
});
