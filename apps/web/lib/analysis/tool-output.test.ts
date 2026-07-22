import { describe, expect, it } from "vitest";

import { analysisPlanSchema } from "./contracts";
import { prepareAnalysis } from "./prepare-analysis";
import { parseAnalysisToolOutput } from "./tool-output";

const plan = analysisPlanSchema.parse({
  version: 1,
  dataset: "uk_price_paid",
  operation: "trend",
  title: "Manchester average price by year",
  explanation: "Yearly average transaction prices in Manchester.",
  metric: "average_price",
  interval: "year",
  splitBy: "town",
  transform: "value",
  filters: {
    dateFrom: "2015-01-01",
    dateTo: "2023-12-31",
    location: { level: "town", values: ["Manchester"] },
    propertyTypes: [],
    newBuild: null,
    tenure: [],
    minimumPrice: null,
    maximumPrice: null,
  },
});

describe("parseAnalysisToolOutput", () => {
  it("accepts the prepared operation-specific result", () => {
    const parsed = parseAnalysisToolOutput(prepareAnalysis(plan));

    expect(parsed.success).toBe(true);

    if (parsed.success && parsed.data.status === "ready") {
      expect(parsed.data.request.shape).toBe("time_series");
      expect(parsed.data.request.filters.location?.values).toEqual([
        "MANCHESTER",
      ]);
    }
  });

  it("rejects malformed tool output at the browser boundary", () => {
    const parsed = parseAnalysisToolOutput({
      status: "ready",
      plan,
      request: { shape: "matrix", metric: "not-a-metric" },
    });

    expect(parsed.success).toBe(false);
  });
});
