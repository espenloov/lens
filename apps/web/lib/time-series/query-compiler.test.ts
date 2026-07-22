import { describe, expect, it } from "vitest";

import { timeSeriesRequestSchema } from "./contracts";
import { compileTimeSeriesQuery } from "./query-compiler";

describe("timeSeriesRequestSchema", () => {
  it("rejects a reversed date range", () => {
    const result = timeSeriesRequestSchema.safeParse({
      metric: "average_price",
      interval: "year",
      dateFrom: "2023-01-01",
      dateTo: "2020-01-01",
      location: {
        level: "town",
        values: ["Manchester"],
      },
      propertyTypes: [],
    });

    expect(result.success).toBe(false);
  });
});

describe("compileTimeSeriesQuery", () => {
  it("compiles yearly average prices into the stable Arrow schema", () => {
    const request = timeSeriesRequestSchema.parse({
      metric: "average_price",
      interval: "year",
      dateFrom: "2015-01-01",
      dateTo: "2023-12-31",
      location: {
        level: "town",
        values: ["Manchester"],
      },
      propertyTypes: [],
    });

    const compiled = compileTimeSeriesQuery(request);

    expect(compiled.query).toContain(
      "toDate(toStartOfYear(date)) AS period_start",
    );
    expect(compiled.query).toContain("toString(town) AS series");
    expect(compiled.query).toContain("toFloat64(avg(price)) AS value");
    expect(compiled.query).not.toContain("Manchester");
    expect(compiled.queryParams).toEqual({
      dateFrom: "2015-01-01",
      dateTo: "2023-12-31",
      locations: ["MANCHESTER"],
      propertyTypes: [],
    });
  });

  it("compiles monthly transaction volume for multiple locations", () => {
    const request = timeSeriesRequestSchema.parse({
      metric: "transaction_count",
      interval: "month",
      dateFrom: "2020-01-01",
      dateTo: "2023-12-31",
      location: {
        level: "town",
        values: ["Leeds", "Bristol"],
      },
      propertyTypes: ["detached", "flat"],
    });

    const compiled = compileTimeSeriesQuery(request);

    expect(compiled.query).toContain(
      "toDate(toStartOfMonth(date)) AS period_start",
    );
    expect(compiled.query).toContain("toFloat64(count()) AS value");
    expect(compiled.query).toContain(
      "AND type IN {propertyTypes: Array(String)}",
    );
    expect(compiled.queryParams.locations).toEqual(["LEEDS", "BRISTOL"]);
    expect(compiled.queryParams.propertyTypes).toEqual(["D", "F"]);
  });
});
