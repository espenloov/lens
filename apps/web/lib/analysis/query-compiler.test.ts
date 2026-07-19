import { describe, expect, it } from "vitest";

import type { AnalysisPlan } from "./contracts";
import { compileAnalysisQuery } from "./query-compiler";

const supportedPlan: AnalysisPlan = {
  title: "Manchester average sale price by year",
  analysisType: "trend",
  metric: "average_price",
  groupBy: ["year"],
  filters: {
    dateFrom: "2015-01-01",
    dateTo: "2023-12-31",
    propertyTypes: [],
    newBuild: null,
    tenure: [],
    location: {
      level: "town",
      values: ["Manchester"],
    },
    maximumPrice: null,
  },
  order: "ascending",
  limit: null,
  visualization: "time_series",
  explanation:
    "Average recorded sale price for properties in Manchester by year.",
};

describe("compileAnalysisQuery", () => {
  it("compiles a supported plan using ClickHouse query parameters", () => {
    const result = compileAnalysisQuery(supportedPlan);

    if (result.isErr()) {
      throw new Error(result.error.message);
    }

    expect(result.value.query).toContain(
      "AND town IN {towns: Array(String)}",
    );
    expect(result.value.query).not.toContain("Manchester");
    expect(result.value.queryParams).toEqual({
      dateFrom: "2015-01-01",
      dateTo: "2023-12-31",
      towns: ["MANCHESTER"],
    });
  });

  it("rejects an analysis capability that has not been implemented", () => {
    const result = compileAnalysisQuery({
      ...supportedPlan,
      metric: "median_price",
    });

    if (result.isOk()) {
      throw new Error("Expected the compiler to reject median price");
    }

    expect(result.error).toEqual({
      type: "unsupported_analysis_plan",
      message:
        "Only average-price trend analyses using a time-series visualization are currently supported",
    });
  });
});
