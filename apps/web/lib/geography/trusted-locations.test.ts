import { describe, expect, it } from "vitest";

import type { TimeSeriesRequest } from "../time-series/contracts";

import { resolveTrustedLocations } from "./trusted-locations";

type TrendRequest = Extract<TimeSeriesRequest, { operation: "trend" }>;

function request(): TrendRequest {
  return {
    shape: "time_series",
    dataset: "uk_price_paid",
    filters: {
      dateFrom: "2015-01-01",
      dateTo: "2023-12-31",
      location: {
        level: "town",
        values: ["Liverpool"],
      },
      propertyTypes: [],
      newBuild: null,
      tenure: [],
      minimumPrice: null,
      maximumPrice: null,
    },
    operation: "trend",
    metric: "average_price",
    interval: "year",
    seriesBy: null,
    transform: "value",
    anomalyThreshold: null,
  };
}

describe("resolveTrustedLocations", () => {
  it("resolves geography for the built-in property dataset", () => {
    expect(resolveTrustedLocations(request())).toEqual([
      {
        key: "liverpool",
        label: "Liverpool",
        longitude: -2.9916,
        latitude: 53.4084,
      },
    ]);
  });

  it("returns one stable point collection for the same geography", () => {
    expect(resolveTrustedLocations(request())).toBe(
      resolveTrustedLocations(request()),
    );
  });

  it("never adds a map to a dataset without trusted geography", () => {
    const taxiRequest = request();
    taxiRequest.dataset = "nyc_taxi";
    taxiRequest.datasetVersion = 1;

    expect(resolveTrustedLocations(taxiRequest)).toEqual([]);
  });

  it("does not guess coordinates for unsupported geography levels", () => {
    const districtRequest = request();
    districtRequest.filters.location = {
      level: "district",
      values: ["Manchester"],
    };

    expect(resolveTrustedLocations(districtRequest)).toEqual([]);
  });
});
