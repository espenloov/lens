import { describe, expect, it } from "vitest";

import { parseAnalysisToolOutput } from "./tool-output";

const plan = {
  title: "Manchester average price by year, 2015–2023",
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
    "Yearly average transaction prices in Manchester from 2015 through 2023.",
} as const;

describe("parseAnalysisToolOutput", () => {
  it("accepts a prepared Trigger time-series request", () => {
    const parsed = parseAnalysisToolOutput({
      status: "ready",
      plan,
      request: {
        metric: "average_price",
        interval: "year",
        dateFrom: "2015-01-01",
        dateTo: "2023-12-31",
        location: {
          level: "town",
          values: ["Manchester"],
        },
        propertyTypes: [],
      },
    });

    expect(parsed.success).toBe(true);

    if (parsed.success && parsed.data.status === "ready") {
      expect(parsed.data.request.metric).toBe("average_price");
      expect(parsed.data.request.location.values).toEqual(["Manchester"]);
    }
  });

  it("accepts an unsupported result as typed application data", () => {
    const parsed = parseAnalysisToolOutput({
      status: "unsupported",
      plan,
      error: {
        type: "unsupported_analysis_plan",
        message: "Median price is not supported yet",
      },
    });

    expect(parsed.success).toBe(true);
  });

  it("rejects malformed tool output at the browser boundary", () => {
    const parsed = parseAnalysisToolOutput({
      status: "ready",
      plan,
      request: {
        metric: "not-a-metric",
      },
    });

    expect(parsed.success).toBe(false);
  });
});
