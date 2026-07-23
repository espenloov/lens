import { describe, expect, it } from "vitest";

import { timeSeriesRequestSchema } from "../analysis/execution";
import { createAnalysisSignature } from "../query-arena/signature";

function registeredTrend(version?: number) {
  return {
    shape: "time_series" as const,
    dataset: "nyc_taxi",
    ...(version === undefined ? {} : { datasetVersion: version }),
    operation: "trend" as const,
    metric: "average_price" as const,
    interval: "month" as const,
    seriesBy: null,
    transform: "value" as const,
    anomalyThreshold: null,
    filters: {
      dateFrom: "2024-01-01",
      dateTo: "2024-12-31",
      location: null,
      propertyTypes: [],
      newBuild: null,
      tenure: [],
      minimumPrice: null,
      maximumPrice: null,
    },
  };
}

describe("registered dataset version pinning", () => {
  it("rejects an executable request without an immutable dataset version", () => {
    expect(
      timeSeriesRequestSchema.safeParse(registeredTrend()).success,
    ).toBe(false);
  });

  it("makes the dataset version part of the deterministic analysis identity", () => {
    const versionOne = timeSeriesRequestSchema.parse(
      registeredTrend(1),
    );
    const sameVersion = timeSeriesRequestSchema.parse(
      registeredTrend(1),
    );
    const versionTwo = timeSeriesRequestSchema.parse(
      registeredTrend(2),
    );

    expect(createAnalysisSignature(versionOne)).toBe(
      createAnalysisSignature(sameVersion),
    );
    expect(createAnalysisSignature(versionOne)).not.toBe(
      createAnalysisSignature(versionTwo),
    );
  });
});
