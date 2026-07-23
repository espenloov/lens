import { describe, expect, it } from "vitest";

import { compileSemanticMetric } from "../analysis/query-compiler";
import { PROPERTY_TRANSACTION_MANIFEST } from "./property-manifest";
import {
  analyticalTableManifestSchema,
  compileMeasureAggregation,
  deriveAnalyticalCapabilities,
  findAnalyticalDimension,
  findAnalyticalMeasure,
  type AnalyticalTableManifest,
} from "./semantic";

const TAXI_MANIFEST = analyticalTableManifestSchema.parse({
  contract: "analytical_table/v1",
  identifier: {
    key: "trip_id",
    label: "Trip",
    expression: "trip_id",
  },
  time: {
    key: "pickup_at",
    label: "Pickup time",
    expression: "pickup_at",
    storageType: "datetime",
    granularities: ["year", "month"],
    timezone: "America/New_York",
  },
  measures: [
    {
      key: "fare_amount",
      label: "Fare",
      expression: "fare_amount",
      defaultAggregation: "average",
      aggregations: ["average", "median", "sum", "minimum", "maximum"],
      format: {
        kind: "currency",
        currency: "USD",
        maximumFractionDigits: 2,
      },
      resultScale: 2,
      supportsDistribution: true,
    },
    {
      key: "trip_distance",
      label: "Trip distance",
      expression: "trip_distance",
      defaultAggregation: "average",
      aggregations: ["average", "sum", "maximum"],
      format: {
        kind: "number",
        maximumFractionDigits: 2,
      },
      resultScale: 2,
      supportsDistribution: true,
    },
  ],
  dimensions: [
    {
      key: "pickup_borough",
      label: "Pickup borough",
      expression: "toString(pickup_borough)",
      filterExpression: "pickup_borough",
      orderExpression: null,
      codeExpression: null,
      kind: "categorical",
      compact: false,
      geographyLevel: null,
      values: [],
    },
    {
      key: "payment_type",
      label: "Payment type",
      expression: "toString(payment_type)",
      filterExpression: "payment_type",
      orderExpression: "payment_type",
      codeExpression: "toUInt8(payment_type)",
      kind: "categorical",
      compact: true,
      geographyLevel: null,
      values: [
        { value: 1, label: "Credit card", order: 1, code: 1 },
        { value: 2, label: "Cash", order: 2, code: 2 },
      ],
    },
  ],
  geography: null,
});

function withoutTime(
  manifest: AnalyticalTableManifest,
): AnalyticalTableManifest {
  return analyticalTableManifestSchema.parse({
    ...manifest,
    time: null,
  });
}

describe("analytical_table/v1 semantic adapter", () => {
  it("describes semantically different property and taxi datasets", () => {
    const propertyCapabilities = deriveAnalyticalCapabilities(
      PROPERTY_TRANSACTION_MANIFEST,
    );
    const taxiCapabilities = deriveAnalyticalCapabilities(TAXI_MANIFEST);

    expect(propertyCapabilities.measureKeys).toEqual(["price"]);
    expect(propertyCapabilities.geographyKeys).toEqual([
      "county",
      "district",
      "town",
    ]);
    expect(taxiCapabilities.measureKeys).toEqual([
      "fare_amount",
      "trip_distance",
    ]);
    expect(taxiCapabilities.dimensionKeys).toEqual([
      "pickup_borough",
      "payment_type",
    ]);
    expect(taxiCapabilities.operations).toEqual({
      trend: true,
      comparison: true,
      ranking: true,
      distribution: true,
      composition: true,
      heatmap: false,
      anomaly: true,
      exploration: false,
    });
  });

  it("removes every time-dependent capability when a dataset has no time role", () => {
    const capabilities = deriveAnalyticalCapabilities(
      withoutTime(TAXI_MANIFEST),
    );

    expect(capabilities.operations.trend).toBe(false);
    expect(capabilities.operations.anomaly).toBe(false);
    expect(capabilities.operations.exploration).toBe(false);
    expect(capabilities.timeGranularities).toEqual([]);
    expect(capabilities.operations.comparison).toBe(true);
    expect(capabilities.operations.ranking).toBe(true);
    expect(capabilities.operations.distribution).toBe(true);
  });

  it("fails closed for malformed semantic keys and contradictory roles", () => {
    const injectedKey = structuredClone(TAXI_MANIFEST);
    injectedKey.measures[0]!.key = "fare); DROP TABLE trips; --";

    const duplicateRole = structuredClone(TAXI_MANIFEST);
    duplicateRole.dimensions[0]!.key = "fare_amount";

    const unsupportedDefault = structuredClone(TAXI_MANIFEST);
    unsupportedDefault.measures[0]!.defaultAggregation = "sum";
    unsupportedDefault.measures[0]!.aggregations = ["average"];

    const incompleteCompactDimension = structuredClone(TAXI_MANIFEST);
    incompleteCompactDimension.dimensions[1]!.codeExpression = null;

    const duplicateCompactCode = structuredClone(TAXI_MANIFEST);
    duplicateCompactCode.dimensions[1]!.values[1]!.code = 1;

    const duplicateDimensionValue = structuredClone(TAXI_MANIFEST);
    duplicateDimensionValue.dimensions[1]!.values[1]!.value = 1;

    const missingCompactCodebook = structuredClone(TAXI_MANIFEST);
    missingCompactCodebook.dimensions[1]!.values = [];

    expect(
      analyticalTableManifestSchema.safeParse(injectedKey).success,
    ).toBe(false);
    expect(
      analyticalTableManifestSchema.safeParse(duplicateRole).success,
    ).toBe(false);
    expect(
      analyticalTableManifestSchema.safeParse(unsupportedDefault).success,
    ).toBe(false);
    expect(
      analyticalTableManifestSchema.safeParse(incompleteCompactDimension)
        .success,
    ).toBe(false);
    expect(
      analyticalTableManifestSchema.safeParse(duplicateCompactCode).success,
    ).toBe(false);
    expect(
      analyticalTableManifestSchema.safeParse(duplicateDimensionValue).success,
    ).toBe(false);
    expect(
      analyticalTableManifestSchema.safeParse(missingCompactCodebook).success,
    ).toBe(false);
  });

  it("derives heatmap axes only from dimensions and declared granularities", () => {
    const oneTimeAxisOnly = analyticalTableManifestSchema.parse({
      ...TAXI_MANIFEST,
      dimensions: [],
      time: {
        ...TAXI_MANIFEST.time!,
        granularities: ["month"],
      },
    });

    expect(
      deriveAnalyticalCapabilities(oneTimeAxisOnly).operations.heatmap,
    ).toBe(false);
  });

  it("resolves only registered semantic keys and allowed aggregations", () => {
    const fare = findAnalyticalMeasure(TAXI_MANIFEST, "fare_amount");

    expect(fare).not.toBeNull();
    expect(findAnalyticalMeasure(TAXI_MANIFEST, "price")).toBeNull();
    expect(
      findAnalyticalMeasure(
        TAXI_MANIFEST,
        "fare_amount) FROM system.tables --",
      ),
    ).toBeNull();
    expect(findAnalyticalDimension(TAXI_MANIFEST, "town")).toBeNull();
    expect(compileMeasureAggregation(fare!, "average")).toBe(
      "toFloat64(round(avg(fare_amount), 2))",
    );
    expect(() => compileMeasureAggregation(fare!, "sum")).not.toThrow();

    const distance = findAnalyticalMeasure(TAXI_MANIFEST, "trip_distance");
    expect(() =>
      compileMeasureAggregation(distance!, "median"),
    ).toThrowError(
      "Measure trip_distance does not support aggregation median",
    );
  });

  it("compiles the same metric operation for unrelated manifests without model SQL", () => {
    expect(
      compileSemanticMetric(PROPERTY_TRANSACTION_MANIFEST, {
        kind: "measure",
        measure: "price",
        aggregation: "average",
      }),
    ).toBe("toFloat64(round(avg(price), 0))");
    expect(
      compileSemanticMetric(TAXI_MANIFEST, {
        kind: "measure",
        measure: "fare_amount",
        aggregation: "average",
      }),
    ).toBe("toFloat64(round(avg(fare_amount), 2))");
    expect(() =>
      compileSemanticMetric(TAXI_MANIFEST, {
        kind: "measure",
        measure: "fare_amount) FROM system.tables --",
        aggregation: "average",
      }),
    ).toThrowError(
      "The analytical source does not declare measure fare_amount) FROM system.tables --",
    );
  });
});
