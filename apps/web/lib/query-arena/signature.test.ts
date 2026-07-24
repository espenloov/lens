import { describe, expect, it } from "vitest";

import { timeSeriesRequestSchema } from "../time-series/contracts";
import {
  semanticAnalysisRequestSchema,
} from "../analysis/semantic-plan";

import {
  createAnalysisSignature,
  createArenaId,
  createQueryArenaIdentity,
  createQueryArenaSignature,
  createSemanticFamilyHash,
  normalizeSemanticFamily,
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
  it("deduplicates retries for one answer without collapsing later answers", () => {
    const signature = createAnalysisSignature(request(["Manchester"]));

    expect(createArenaId(signature, "query-1")).toBe(
      createArenaId(signature, "query-1"),
    );
    expect(createArenaId(signature, "query-2")).not.toBe(
      createArenaId(signature, "query-1"),
    );
  });
});

describe("createQueryArenaSignature", () => {
  it("reuses a physical recipe for sibling filters on the same dataset", () => {
    const manchester = request(["Manchester"]);
    const liverpool = request(["Liverpool"]);

    expect(
      createQueryArenaSignature({
        kind: "time_series",
        request: manchester,
      }),
    ).toBe(
      createQueryArenaSignature({
        kind: "time_series",
        request: liverpool,
      }),
    );
  });

  it("pins generic recipes to dataset versions but ignores presentation copy", () => {
    const semantic = semanticAnalysisRequestSchema.parse({
      shape: "time_series",
      transform: "value",
      presentation: {
        valueLabel: "Fare",
        valueFormat: {
          kind: "currency",
          currency: "USD",
          maximumFractionDigits: 2,
        },
        categoryLabel: "Payment type",
        distributionMeasureFormat: null,
      },
      plan: {
        version: 1,
        dataset: "nyc_taxi",
        datasetVersion: 1,
        title: "Monthly fares",
        explanation: "First wording.",
        operation: "trend",
        metric: {
          kind: "measure",
          measure: "fare_amount",
          aggregation: "average",
        },
        interval: "month",
        splitBy: "payment_type",
        filters: {
          timeRange: {
            from: "2010-01-01",
            to: "2020-12-31",
          },
          dimensions: [],
          measures: [],
        },
      },
    });
    const renamed = {
      ...semantic,
      plan: {
        ...semantic.plan,
        title: "Same query",
        explanation: "Different wording.",
      },
    };
    const nextVersion = {
      ...semantic,
      plan: {
        ...semantic.plan,
        datasetVersion: 2,
      },
    };

    expect(
      createQueryArenaSignature({ kind: "semantic", request: semantic }),
    ).toBe(
      createQueryArenaSignature({ kind: "semantic", request: renamed }),
    );
    expect(
      createQueryArenaSignature({ kind: "semantic", request: semantic }),
    ).not.toBe(
      createQueryArenaSignature({ kind: "semantic", request: nextVersion }),
    );
  });

  it("keeps exact execution recipes local to a dataset and version", () => {
    const taxi = semanticAnalysisRequestSchema.parse({
      shape: "time_series",
      transform: "value",
      presentation: {
        valueLabel: "Fare",
        valueFormat: {
          kind: "currency",
          currency: "USD",
          maximumFractionDigits: 2,
        },
        categoryLabel: "Payment type",
        distributionMeasureFormat: null,
      },
      plan: {
        version: 1,
        dataset: "nyc_taxi",
        datasetVersion: 1,
        title: "Monthly fares",
        explanation: "Taxi analysis.",
        operation: "trend",
        metric: {
          kind: "measure",
          measure: "fare_amount",
          aggregation: "average",
        },
        interval: "month",
        splitBy: "payment_type",
        filters: {
          timeRange: {
            from: "2010-01-01",
            to: "2020-12-31",
          },
          dimensions: [],
          measures: [],
        },
      },
    });
    const telemetry = semanticAnalysisRequestSchema.parse({
      ...taxi,
      plan: {
        ...taxi.plan,
        dataset: "network_telemetry",
        datasetVersion: 3,
        metric: {
          kind: "measure",
          measure: "latency_ms",
          aggregation: "average",
        },
        splitBy: "service",
      },
    });

    const taxiIdentity = createQueryArenaIdentity({
      kind: "semantic",
      request: taxi,
    });
    const telemetryIdentity = createQueryArenaIdentity({
      kind: "semantic",
      request: telemetry,
    });

    expect(taxiIdentity.executionSignature).not.toBe(
      telemetryIdentity.executionSignature,
    );
    expect(taxiIdentity.semanticFamilyHash).toBe(
      telemetryIdentity.semanticFamilyHash,
    );
  });

  it("does not include literal dimension names or values in a semantic family", () => {
    const first = semanticAnalysisRequestSchema.parse({
      shape: "time_series",
      transform: "value",
      presentation: {
        valueLabel: "Fare",
        valueFormat: {
          kind: "currency",
          currency: "USD",
          maximumFractionDigits: 2,
        },
        categoryLabel: "Zone",
        distributionMeasureFormat: null,
      },
      plan: {
        version: 1,
        dataset: "nyc_taxi",
        datasetVersion: 1,
        title: "Fares",
        explanation: "First analysis.",
        operation: "trend",
        metric: {
          kind: "measure",
          measure: "fare_amount",
          aggregation: "average",
        },
        interval: "month",
        splitBy: "pickup_zone",
        filters: {
          timeRange: {
            from: "2020-01-01",
            to: "2020-12-31",
          },
          dimensions: [
            {
              dimension: "pickup_zone",
              values: ["Queens", "Brooklyn"],
            },
          ],
          measures: [],
        },
      },
    });
    const renamed = semanticAnalysisRequestSchema.parse({
      ...first,
      plan: {
        ...first.plan,
        dataset: "service_logs",
        metric: {
          kind: "measure",
          measure: "duration_ms",
          aggregation: "average",
        },
        splitBy: "service",
        filters: {
          ...first.plan.filters,
          dimensions: [
            {
              dimension: "service",
              values: ["api", "worker"],
            },
          ],
        },
      },
    });

    expect(
      createSemanticFamilyHash({ kind: "semantic", request: first }),
    ).toBe(
      createSemanticFamilyHash({ kind: "semantic", request: renamed }),
    );
  });

  it("separates families when the compute shape changes", () => {
    const comparison = request(["Manchester", "Liverpool"]);
    const trend = timeSeriesRequestSchema.parse({
      ...comparison,
      operation: "trend",
      seriesBy: null,
    });

    expect(
      createSemanticFamilyHash({
        kind: "time_series",
        request: comparison,
      }),
    ).not.toBe(
      createSemanticFamilyHash({
        kind: "time_series",
        request: trend,
      }),
    );
  });

  it("classifies filter cardinality without retaining private values", () => {
    const normalized = normalizeSemanticFamily({
      kind: "time_series",
      request: request(["Manchester", "Liverpool"]),
    });

    expect(JSON.stringify(normalized)).not.toContain("MANCHESTER");
    expect(JSON.stringify(normalized)).not.toContain("LIVERPOOL");
    expect(normalized).toMatchObject({
      grouping: {
        dimensions: 1,
        cardinality: "small",
      },
      filters: {
        dimensions: ["small"],
      },
    });
  });
});
