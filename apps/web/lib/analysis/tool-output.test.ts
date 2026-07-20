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
  it("accepts a completed Trigger analysis result", () => {
    const parsed = parseAnalysisToolOutput({
      status: "completed",
      plan,
      result: {
        kind: "yearly_average_price",
        points: [
          {
            year: 2023,
            averagePrice: 270_667,
            transactionCount: 9_595,
          },
        ],
        queryId: "bbd862cd-f871-4011-8f6a-b080e96e42b9",
        performance: {
          roundTripMs: 19_606,
          serverElapsedMs: 299.301773,
          rowsRead: 28_919_900,
          bytesRead: 61_683_314,
        },
        calculatedAt: "2026-07-19T08:27:13.183Z",
      },
    });

    expect(parsed.success).toBe(true);

    if (parsed.success && parsed.data.status === "completed") {
      expect(parsed.data.result.points[0]?.averagePrice).toBe(270_667);
      expect(parsed.data.result.performance.rowsRead).toBe(28_919_900);
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
      status: "completed",
      plan,
      result: {
        kind: "yearly_average_price",
        points: [{ year: 2023, averagePrice: "not-a-number" }],
      },
    });

    expect(parsed.success).toBe(false);
  });
});
