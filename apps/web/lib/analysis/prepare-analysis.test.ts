import { describe, expect, it } from "vitest";

import type { AnalysisPlan } from "./contracts";
import { prepareAnalysis } from "./prepare-analysis";

const plan: AnalysisPlan = {
  title: "Manchester and Liverpool in 2018",
  analysisType: "comparison",
  metric: "average_price",
  groupBy: ["year", "town"],
  filters: {
    dateFrom: "2018-01-01",
    dateTo: "2018-12-31",
    propertyTypes: [],
    newBuild: null,
    tenure: [],
    location: {
      level: "town",
      values: ["Manchester", "Liverpool"],
    },
    maximumPrice: null,
  },
  order: "ascending",
  limit: null,
  visualization: "comparison",
  explanation: "Compare average prices in both towns.",
};

describe("prepareAnalysis", () => {
  it("prepares a supported plan without starting a nested task", () => {
    expect(prepareAnalysis(plan)).toMatchObject({
      status: "ready",
      request: {
        metric: "average_price",
        interval: "year",
        location: {
          level: "town",
          values: ["Manchester", "Liverpool"],
        },
      },
    });
  });

  it("returns a safe unsupported result", () => {
    const result = prepareAnalysis({
      ...plan,
      filters: { ...plan.filters, newBuild: true },
    });

    expect(result).toMatchObject({
      status: "unsupported",
      error: { type: "unsupported_analysis_plan" },
    });
  });
});
