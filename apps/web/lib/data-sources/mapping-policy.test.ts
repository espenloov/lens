import { describe, expect, it } from "vitest";

import type { InspectedRelation } from "./contracts";
import { validateMappingSql } from "./mapping-policy";
import { analyticalTableManifestSchema } from "./semantic";

const relation: InspectedRelation = {
  database: "default",
  table: "sales",
  engine: "MergeTree",
  estimatedRows: 10,
  columns: [
    { name: "sold_at", type: "Date", position: 1 },
    { name: "amount", type: "UInt64", position: 2 },
    { name: "city", type: "String", position: 3 },
    { name: "region", type: "String", position: 4 },
    { name: "category", type: "String", position: 5 },
    { name: "tenure_code", type: "String", position: 6 },
    { name: "new_flag", type: "UInt8", position: 7 },
  ],
};

const validSql = `
  SELECT
    toDate(sold_at) AS date,
    toUInt64(amount) AS price,
    upper(city) AS town,
    upper(region) AS district,
    upper(region) AS county,
    multiIf(category = 'D', 'detached', category = 'S', 'semi-detached', category = 'T', 'terraced', category = 'F', 'flat', 'other') AS type,
    if(tenure_code = 'F', 'freehold', 'leasehold') AS duration,
    toUInt8(new_flag) AS is_new
  FROM default.sales
`;

const taxiRelation: InspectedRelation = {
  database: "default",
  table: "trips",
  engine: "MergeTree",
  estimatedRows: 1_000_000,
  columns: [
    { name: "pickup_datetime", type: "DateTime", position: 1 },
    { name: "total_amount", type: "Float64", position: 2 },
    { name: "borough", type: "String", position: 3 },
    { name: "payment_code", type: "UInt8", position: 4 },
    { name: "trip_distance", type: "Float64", position: 5 },
    { name: "vendor_name", type: "String", position: 6 },
  ],
};

const taxiManifest = analyticalTableManifestSchema.parse({
  contract: "analytical_table/v1",
  identifier: null,
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
      aggregations: ["average", "sum", "median"],
      format: {
        kind: "currency",
        currency: "USD",
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
      expression: "pickup_borough",
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
      expression: "payment_type",
      filterExpression: "payment_type",
      orderExpression: "payment_type",
      codeExpression: "payment_type",
      kind: "categorical",
      compact: true,
      geographyLevel: null,
      values: [
        { value: 1, label: "Card", order: 1, code: 1 },
        { value: 2, label: "Cash", order: 2, code: 2 },
      ],
    },
  ],
  geography: null,
});

const taxiSql = `
  SELECT
    pickup_datetime AS pickup_at,
    toFloat64(total_amount) AS fare_amount,
    toString(borough) AS pickup_borough,
    toUInt8(payment_code) AS payment_type
  FROM default.trips
`;

describe("validateMappingSql", () => {
  it("normalizes a mapping into the canonical column order", () => {
    const result = validateMappingSql(validSql, relation);

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().normalizedSql).toContain("AS price");
    expect(result._unsafeUnwrap().aliases).toHaveLength(8);
  });

  it.each([
    `${validSql}; DROP TABLE sales`,
    validSql.replace("FROM default.sales", "FROM default.sales JOIN default.users USING id"),
    validSql.replace("FROM default.sales", "FROM other.sales"),
    validSql.replace("toDate(sold_at)", "sleep(10)"),
    validSql.replace("toUInt64(amount) AS price,", ""),
  ])("rejects unsafe or incomplete SQL", (sql) => {
    expect(validateMappingSql(sql, relation).isErr()).toBe(true);
  });

  it("normalizes a non-property mapping against its own semantic manifest", () => {
    const result = validateMappingSql(
      taxiSql,
      taxiRelation,
      taxiManifest,
    );

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().aliases).toEqual([
      "pickup_at",
      "fare_amount",
      "pickup_borough",
      "payment_type",
    ]);
    expect(result._unsafeUnwrap().normalizedSql).not.toContain("price");
  });

  it("keeps safe extra projections that are not selected as semantic roles", () => {
    const result = validateMappingSql(
      taxiSql.replace(
        "toUInt8(payment_code) AS payment_type",
        `toUInt8(payment_code) AS payment_type,
    toFloat64(trip_distance) AS trip_distance,
    toString(vendor_name) AS vendor`,
      ),
      taxiRelation,
      taxiManifest,
    );

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().aliases).toEqual([
      "pickup_at",
      "fare_amount",
      "pickup_borough",
      "payment_type",
      "trip_distance",
      "vendor",
    ]);
    expect(result._unsafeUnwrap().normalizedSql).toContain(
      "toFloat64(trip_distance) AS trip_distance",
    );
  });

  it("rejects model-supplied SQL outside the inspected relation and manifest", () => {
    expect(
      validateMappingSql(
        taxiSql.replace(
          "toFloat64(total_amount)",
          "dictGet('secrets', 'value', payment_code)",
        ),
        taxiRelation,
        taxiManifest,
      ).isErr(),
    ).toBe(true);
    expect(
      validateMappingSql(
        taxiSql.replace("FROM default.trips", "FROM system.tables"),
        taxiRelation,
        taxiManifest,
      ).isErr(),
    ).toBe(true);
  });
});
