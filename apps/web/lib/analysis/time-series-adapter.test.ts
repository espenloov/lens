import { describe, expect, it } from "vitest";

import { analysisPlanSchema } from "./contracts";
import { toTimeSeriesRequest } from "./time-series-adapter";

function plan(overrides: Record<string, unknown> = {}) {
  return analysisPlanSchema.parse({
    title: "Manchester prices",
    analysisType: "trend",
    metric: "average_price",
    groupBy: ["year"],
    filters: {
      dateFrom: "2015-01-01",
      dateTo: "2023-12-31",
      propertyTypes: [],
      newBuild: null,
      tenure: [],
      location: { level: "town", values: ["Manchester"] },
      maximumPrice: null,
    },
    order: "ascending",
    limit: null,
    visualization: "time_series",
    explanation: "Average prices over time.",
    ...overrides,
  });
}

describe("toTimeSeriesRequest", () => {
  it("maps a yearly price trend to the Arrow query contract", () => {
    const result = toTimeSeriesRequest(plan());

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toEqual({
      metric: "average_price",
      interval: "year",
      dateFrom: "2015-01-01",
      dateTo: "2023-12-31",
      location: { level: "town", values: ["Manchester"] },
      propertyTypes: [],
    });
  });

  it("maps a monthly multi-town volume comparison", () => {
    const result = toTimeSeriesRequest(
      plan({
        analysisType: "comparison",
        metric: "transaction_count",
        groupBy: ["month", "town"],
        filters: {
          dateFrom: "2020-01-01",
          dateTo: "2023-12-31",
          propertyTypes: ["detached"],
          newBuild: null,
          tenure: [],
          location: { level: "town", values: ["Leeds", "Bristol"] },
          maximumPrice: null,
        },
        visualization: "comparison",
      }),
    );

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toMatchObject({
      metric: "transaction_count",
      interval: "month",
      location: { values: ["Leeds", "Bristol"] },
      propertyTypes: ["detached"],
    });
  });

  it("accepts a two-town 2018 price comparison with presentation hints", () => {
    const result = toTimeSeriesRequest(
      plan({
        title: "Liverpool vs Manchester in 2018",
        analysisType: "comparison",
        groupBy: ["year", "town"],
        filters: {
          dateFrom: "2018-01-01",
          dateTo: "2018-12-31",
          propertyTypes: [],
          newBuild: null,
          tenure: [],
          location: {
            level: "town",
            values: ["Liverpool", "Manchester"],
          },
          maximumPrice: null,
        },
        order: "descending",
        limit: 2,
        visualization: "comparison",
      }),
    );

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toEqual({
      metric: "average_price",
      interval: "year",
      dateFrom: "2018-01-01",
      dateTo: "2018-12-31",
      location: {
        level: "town",
        values: ["Liverpool", "Manchester"],
      },
      propertyTypes: [],
    });
  });

  it("rejects unsupported analytical filters", () => {
    const result = toTimeSeriesRequest(
      plan({
        filters: {
          dateFrom: "2015-01-01",
          dateTo: "2023-12-31",
          propertyTypes: [],
          newBuild: true,
          tenure: [],
          location: { level: "town", values: ["Manchester"] },
          maximumPrice: null,
        },
      }),
    );

    expect(result.isErr()).toBe(true);
  });

  it("rejects a location dimension that does not match the filter", () => {
    const result = toTimeSeriesRequest(
      plan({ groupBy: ["year", "county"] }),
    );

    expect(result.isErr()).toBe(true);
  });
});
