import { describe, expect, it } from "vitest";

import type { InspectedRelation } from "./contracts";
import { validateMappingSql } from "./mapping-policy";
import {
  createMappingTemplate,
  inferAnalyticalColumns,
  inferAnalyticalManifest,
} from "./schema-inference";
import { deriveAnalyticalCapabilities } from "./semantic";

const CELL_TOWERS: InspectedRelation = {
  database: "default",
  table: "cell_towers",
  engine: "MergeTree",
  estimatedRows: 43_276_150,
  columns: [
    {
      name: "radio",
      type: "Enum8('' = 0, 'CDMA' = 1, 'GSM' = 2, 'LTE' = 3, 'NR' = 4, 'UMTS' = 5)",
      position: 1,
    },
    { name: "mcc", type: "UInt16", position: 2 },
    { name: "net", type: "UInt16", position: 3 },
    { name: "area", type: "UInt16", position: 4 },
    { name: "cell", type: "UInt64", position: 5 },
    { name: "unit", type: "Int16", position: 6 },
    { name: "lon", type: "Float64", position: 7 },
    { name: "lat", type: "Float64", position: 8 },
    { name: "range", type: "UInt32", position: 9 },
    { name: "samples", type: "UInt32", position: 10 },
    { name: "changeable", type: "UInt8", position: 11 },
    { name: "created", type: "DateTime", position: 12 },
    { name: "updated", type: "DateTime", position: 13 },
    { name: "averageSignal", type: "UInt8", position: 14 },
  ],
};

describe("generic analytical schema inference", () => {
  it("finds useful roles in the ClickHouse cell tower dataset", () => {
    const columns = inferAnalyticalColumns(CELL_TOWERS);

    expect(
      columns.map(({ alias, role }) => [alias, role]),
    ).toEqual([
      ["radio", "dimension"],
      ["mcc", "dimension"],
      ["net", "dimension"],
      ["area", "dimension"],
      ["cell", "identifier"],
      ["unit", "dimension"],
      ["range", "measure"],
      ["samples", "measure"],
      ["changeable", "dimension"],
      ["created", "time"],
      ["average_signal", "measure"],
    ]);
  });

  it("creates a useful cell tower mapping instead of treating codes as measures", () => {
    const mapping = createMappingTemplate(CELL_TOWERS);

    expect(mapping).toContain("toFloat64(range) AS range");
    expect(mapping).toContain("toFloat64(samples) AS samples");
    expect(mapping).toContain(
      "toFloat64(averageSignal) AS average_signal",
    );
    expect(mapping).toContain("toString(radio) AS radio");
    expect(mapping).toContain("toString(cell) AS cell");
    expect(mapping).not.toContain("toFloat64(mcc)");
    expect(mapping).not.toContain(" AS lon");
    expect(mapping).not.toContain(" AS lat");
    expect(mapping).not.toContain(" AS updated");
  });

  it("builds a deterministic safety manifest for cell towers", () => {
    const mapping = createMappingTemplate(CELL_TOWERS);
    const manifest = inferAnalyticalManifest(CELL_TOWERS, mapping);

    expect(manifest.identifier?.key).toBe("cell");
    expect(manifest.time).toMatchObject({
      key: "created",
      storageType: "datetime",
    });
    expect(manifest.measures.map(({ key }) => key)).toEqual([
      "range",
      "samples",
      "average_signal",
    ]);
    expect(manifest.dimensions.map(({ key }) => key)).toEqual([
      "radio",
      "mcc",
      "net",
      "area",
      "unit",
      "changeable",
    ]);
    expect(manifest.geography).toBeNull();
    expect(validateMappingSql(mapping, CELL_TOWERS, manifest).isOk()).toBe(
      true,
    );
  });

  it("supports nullable measures, Enum8 dimensions, and camel-case names", () => {
    const relation: InspectedRelation = {
      database: "analytics",
      table: "events",
      engine: "MergeTree",
      estimatedRows: 1_000_000,
      columns: [
        { name: "event_id", type: "UUID", position: 1 },
        { name: "occurredAt", type: "DateTime64(3)", position: 2 },
        { name: "responseTimeMs", type: "Nullable(Float64)", position: 3 },
        {
          name: "eventType",
          type: "LowCardinality(String)",
          position: 4,
        },
        { name: "status", type: "Enum8('ok' = 1, 'error' = 2)", position: 5 },
      ],
    };
    const mapping = createMappingTemplate(relation);
    const manifest = inferAnalyticalManifest(relation, mapping);

    expect(manifest.identifier?.key).toBe("event_id");
    expect(manifest.time?.key).toBe("occurred_at");
    expect(manifest.measures.map(({ key }) => key)).toEqual([
      "response_time_ms",
    ]);
    expect(manifest.dimensions.map(({ key }) => key)).toEqual([
      "event_type",
      "status",
    ]);
  });

  it("infers roles from user-defined aliases without relying on template names", () => {
    const mapping = `SELECT
      toString(cell) AS tower_id,
      created AS observed_at,
      toFloat64(range) AS coverage_radius,
      toString(mcc) AS country_code,
      toString(radio) AS technology
    FROM default.cell_towers`;
    const manifest = inferAnalyticalManifest(CELL_TOWERS, mapping);

    expect(manifest.identifier?.key).toBe("tower_id");
    expect(manifest.time?.key).toBe("observed_at");
    expect(manifest.measures.map(({ key }) => key)).toEqual([
      "coverage_radius",
    ]);
    expect(manifest.dimensions.map(({ key }) => key)).toEqual([
      "country_code",
      "technology",
    ]);
    expect(manifest.geography).toBeNull();
  });

  it("keeps count-only event tables analytically valid", () => {
    const relation: InspectedRelation = {
      database: "analytics",
      table: "deployments",
      engine: "MergeTree",
      estimatedRows: 20_000,
      columns: [
        { name: "deployment_id", type: "String", position: 1 },
        { name: "created_at", type: "DateTime", position: 2 },
        { name: "environment", type: "String", position: 3 },
        { name: "status", type: "String", position: 4 },
      ],
    };
    const mapping = createMappingTemplate(relation);
    const manifest = inferAnalyticalManifest(relation, mapping);
    const capabilities = deriveAnalyticalCapabilities(manifest);

    expect(manifest.measures).toEqual([]);
    expect(capabilities.operations.trend).toBe(true);
    expect(capabilities.operations.comparison).toBe(true);
    expect(capabilities.operations.distribution).toBe(false);
  });

  it("only creates geography from explicit location hierarchy names", () => {
    const relation: InspectedRelation = {
      database: "analytics",
      table: "regional_metrics",
      engine: "MergeTree",
      estimatedRows: 50_000,
      columns: [
        { name: "recorded_on", type: "Date", position: 1 },
        { name: "value", type: "Float64", position: 2 },
        { name: "country", type: "String", position: 3 },
        { name: "region", type: "String", position: 4 },
        { name: "city", type: "String", position: 5 },
      ],
    };
    const mapping = createMappingTemplate(relation);
    const manifest = inferAnalyticalManifest(relation, mapping);

    expect(manifest.geography?.levels).toEqual([
      "country",
      "region",
      "city",
    ]);
    expect(
      manifest.dimensions.map(({ key, geographyLevel }) => [
        key,
        geographyLevel,
      ]),
    ).toEqual([
      ["country", 0],
      ["region", 1],
      ["city", 2],
    ]);
  });
});
