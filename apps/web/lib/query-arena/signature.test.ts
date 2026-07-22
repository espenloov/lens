import { describe, expect, it } from "vitest";

import { timeSeriesRequestSchema } from "../time-series/contracts";

import { createAnalysisSignature, createArenaId } from "./signature";

function request(locations: string[], propertyTypes: string[] = []) {
  return timeSeriesRequestSchema.parse({
    metric: "average_price",
    interval: "year",
    dateFrom: "2018-01-01",
    dateTo: "2018-12-31",
    location: {
      level: "town",
      values: locations,
    },
    propertyTypes,
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
      createAnalysisSignature(request(["Manchester"], ["flat"])),
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
