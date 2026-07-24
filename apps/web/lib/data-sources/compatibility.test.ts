import { Readable } from "node:stream";

import { ok } from "neverthrow";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { InspectedRelation } from "./contracts";
import { validateAnalyticalCompatibility } from "./compatibility";
import { analyticalTableManifestSchema } from "./semantic";

const query = vi.fn();
const exec = vi.fn();

vi.mock("@/lib/clickhouse/client", () => ({
  getClickHouseClient: () => ({ exec, query }),
}));

vi.mock("@/lib/wasm/node-verifier", () => ({
  verifyAnalyticalArrow: () => ok({ rowCount: 2 }),
}));

const RELATION: InspectedRelation = {
  database: "analytics",
  table: "deployments",
  engine: "MergeTree",
  estimatedRows: 100,
  columns: [
    { name: "created_at", type: "DateTime", position: 1 },
    { name: "environment", type: "String", position: 2 },
  ],
};

const MANIFEST = analyticalTableManifestSchema.parse({
  contract: "analytical_table/v1",
  identifier: null,
  time: {
    key: "created_at",
    label: "Created at",
    expression: "created_at",
    storageType: "datetime",
    granularities: ["year", "month"],
    timezone: null,
  },
  measures: [],
  dimensions: [
    {
      key: "environment",
      label: "Environment",
      expression: "toString(environment)",
      filterExpression: "environment",
      orderExpression: null,
      codeExpression: null,
      kind: "categorical",
      compact: false,
      geographyLevel: null,
      values: [],
    },
  ],
  geography: null,
});

describe("generic analytical compatibility", () => {
  beforeEach(() => {
    query.mockReset();
    exec.mockReset();
    query.mockResolvedValue({
      json: async () => [
        {
          row_count: "100",
          time_from: "2025-01-01",
          time_to: "2026-01-01",
          valid_time_count: "98",
          valid_dimension_0: "95",
        },
      ],
    });
    exec.mockResolvedValue({
      stream: Readable.from([Buffer.from("arrow")]),
      summary: {
        elapsed_ns: "1200000",
        read_rows: "100",
        read_bytes: "800",
      },
    });
  });

  it("verifies a count-only dataset and tolerates sparse optional values", async () => {
    const result = await validateAnalyticalCompatibility(
      `SELECT
        created_at AS created_at,
        toString(environment) AS environment
       FROM analytics.deployments`,
      RELATION,
      MANIFEST,
    );

    expect(result.isOk()).toBe(true);
    expect(exec).toHaveBeenCalledOnce();
    expect(exec.mock.calls[0]?.[0].query).toContain(
      "toFloat64(count()) AS value",
    );
    expect(result._unsafeUnwrap()).toMatchObject({
      rowCount: 100,
      dateFrom: "2025-01-01",
      dateTo: "2026-01-01",
      rustVerified: true,
    });
  });
});
