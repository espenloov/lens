import { describe, expect, it } from "vitest";

import { BUILTIN_DATA_SOURCE } from "../../data-sources/builtin";
import { timeSeriesRequestSchema } from "../../time-series/contracts";

import { recommendOrderedProjection } from "./recommendation";

describe("ordered projection recommendation", () => {
  it("derives a whitelisted template from the typed analysis", () => {
    const request = timeSeriesRequestSchema.parse({
      shape: "time_series",
      operation: "comparison",
      metric: "average_price",
      interval: "year",
      seriesBy: "town",
      transform: "value",
      anomalyThreshold: null,
      filters: {
        dateFrom: "2018-01-01",
        dateTo: "2023-12-31",
        location: {
          level: "town",
          values: ["Manchester", "Liverpool"],
        },
        propertyTypes: [],
        newBuild: null,
        tenure: [],
        minimumPrice: null,
        maximumPrice: null,
      },
    });
    const result = recommendOrderedProjection(BUILTIN_DATA_SOURCE, {
      kind: "time_series",
      request,
    });

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toMatchObject({
      kind: "ordered_projection_v1",
      timeKey: "date",
      dimensionKeys: ["town"],
    });
  });
});
