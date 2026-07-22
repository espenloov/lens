import { describe, expect, it } from "vitest";

import { timeSeriesRequestSchema } from "../time-series/contracts";

import {
  createAnalysisSignature,
  createArenaId,
  supportsQueryArena,
} from "./signature";

function request(locations: string[], metric = "average_price") {
  return timeSeriesRequestSchema.parse({
    shape: "time_series",
    operation: "comparison",
    metric,
    interval: "year",
    seriesBy: "town",
    transform: "value",
    anomalyThreshold: null,
    filters: {
      dateFrom: "2018-01-01",
      dateTo: "2018-12-31",
      location: { level: "town", values: locations },
      propertyTypes: [],
      newBuild: null,
      tenure: [],
      minimumPrice: null,
      maximumPrice: null,
    },
  });
}

describe("createAnalysisSignature", () => {
  it("is stable across location casing and ordering", () => {
    expect(createAnalysisSignature(request(["Manchester", "Liverpool"]))).toBe(
      createAnalysisSignature(request(["LIVERPOOL", "manchester"])),
    );
  });

  it("changes when the analysis meaning changes", () => {
    expect(createAnalysisSignature(request(["Manchester"]))).not.toBe(
      createAnalysisSignature(request(["Manchester"], "transaction_count")),
    );
  });

  it("excludes approximate medians from exact verification", () => {
    expect(supportsQueryArena(request(["Manchester"], "median_price"))).toBe(
      false,
    );
  });
});

describe("createArenaId", () => {
  it("deduplicates the same analysis within an hourly benchmark window", () => {
    const signature = createAnalysisSignature(request(["Manchester"]));

    expect(createArenaId(signature, new Date("2026-07-22T12:05:00Z"))).toBe(
      createArenaId(signature, new Date("2026-07-22T12:59:00Z")),
    );
    expect(createArenaId(signature, new Date("2026-07-22T13:00:00Z"))).not.toBe(
      createArenaId(signature, new Date("2026-07-22T12:59:00Z")),
    );
  });
});
