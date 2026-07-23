import { describe, expect, it } from "vitest";

import { BUILTIN_DATA_SOURCE, toDataSourceSummary } from "../data-sources/builtin";
import {
  attachRegisteredDiscoverySources,
  discoveryDatabaseAllowlist,
  parseTableDiscoveryRows,
} from "./table-discovery";

const rows = [
  {
    database: "default",
    table: "trips",
    engine: "MergeTree",
    estimated_rows: "1000000",
    estimated_bytes: "52428800",
    modified_at: "2026-07-23 10:15:30",
    column_name: "pickup_at",
    column_type: "DateTime",
    column_position: "1",
  },
  {
    database: "default",
    table: "trips",
    engine: "MergeTree",
    estimated_rows: "1000000",
    estimated_bytes: "52428800",
    modified_at: "2026-07-23 10:15:30",
    column_name: "fare_amount",
    column_type: "Float64",
    column_position: "2",
  },
  {
    database: "default",
    table: "small_events",
    engine: "ReplacingMergeTree",
    estimated_rows: 40,
    estimated_bytes: 2048,
    modified_at: null,
    column_name: "event_date",
    column_type: "Nullable(Date32)",
    column_position: 1,
  },
  {
    database: "default",
    table: "query_arena_performance_history",
    engine: "MergeTree",
    estimated_rows: 99,
    estimated_bytes: 4096,
    modified_at: null,
    column_name: "recorded_at",
    column_type: "DateTime64(3)",
    column_position: 1,
  },
  {
    database: "default",
    table: "lens_schema_migrations",
    engine: "MergeTree",
    estimated_rows: 1,
    estimated_bytes: 256,
    modified_at: null,
    column_name: "version",
    column_type: "UInt32",
    column_position: 1,
  },
];

describe("ClickHouse discovery allowlist", () => {
  it("includes only identifier-safe configured and explicitly allowlisted databases", () => {
    const result = discoveryDatabaseAllowlist(
      "default",
      "analytics, telemetry,analytics",
    );

    expect(result._unsafeUnwrap()).toEqual([
      "default",
      "analytics",
      "telemetry",
    ]);
    expect(
      discoveryDatabaseAllowlist("default", "analytics; DROP DATABASE default")
        .isErr(),
    ).toBe(true);
    expect(discoveryDatabaseAllowlist("default", "system").isErr()).toBe(true);
  });
});

describe("parseTableDiscoveryRows", () => {
  it("builds a bounded schema summary and excludes internal application tables", () => {
    const result = parseTableDiscoveryRows(rows, "default");

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toEqual({
      database: "default",
      tables: [
        {
          database: "default",
          table: "trips",
          engine: "MergeTree",
          estimatedRows: 1_000_000,
          estimatedBytes: 52_428_800,
          columnCount: 2,
          modifiedAt: "2026-07-23T10:15:30.000Z",
          dateColumns: ["pickup_at"],
          columns: [
            { name: "pickup_at", type: "DateTime", position: 1 },
            { name: "fare_amount", type: "Float64", position: 2 },
          ],
          registered: null,
        },
        {
          database: "default",
          table: "small_events",
          engine: "ReplacingMergeTree",
          estimatedRows: 40,
          estimatedBytes: 2048,
          columnCount: 1,
          modifiedAt: null,
          dateColumns: ["event_date"],
          columns: [
            {
              name: "event_date",
              type: "Nullable(Date32)",
              position: 1,
            },
          ],
          registered: null,
        },
      ],
    });
  });

  it.each([
    [
      "unsafe identifier",
      [{ ...rows[0], table: "trips; DROP TABLE users" }],
    ],
    [
      "cross-database row",
      [{ ...rows[0], database: "system" }],
    ],
    [
      "inconsistent table metadata",
      [rows[0], { ...rows[1], estimated_rows: 10 }],
    ],
    [
      "duplicate column position",
      [rows[0], { ...rows[1], column_position: 1 }],
    ],
    [
      "invalid timestamp",
      [{ ...rows[0], modified_at: "not-a-date" }],
    ],
  ])("rejects a malformed %s", (_name, malformed) => {
    expect(parseTableDiscoveryRows(malformed, "default").isErr()).toBe(true);
  });

  it("attaches only safe registration identity metadata", () => {
    const discovery = parseTableDiscoveryRows(
      [
        {
          ...rows[0],
          table: "pp_complete",
        },
      ],
      "default",
    )._unsafeUnwrap();
    const attached = attachRegisteredDiscoverySources(discovery, [
      toDataSourceSummary(BUILTIN_DATA_SOURCE, true),
    ]);

    expect(attached.tables[0]?.registered).toEqual({
      slug: "uk_price_paid",
      version: 1,
    });
  });
});
