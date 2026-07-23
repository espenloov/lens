import { errAsync, okAsync } from "neverthrow";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createDataSourceSessionCookie } from "../../../../lib/data-sources/access";

const mocks = vi.hoisted(() => ({
  discover: vi.fn(),
  list: vi.fn(),
}));

vi.mock("../../../../lib/clickhouse/table-discovery", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("../../../../lib/clickhouse/table-discovery")
    >();

  return {
    ...actual,
    discoverClickHouseTables: mocks.discover,
  };
});

vi.mock("../../../../lib/data-sources/registry", () => ({
  listDataSources: mocks.list,
}));

import { GET } from "./route";

const originalNodeEnv = process.env.NODE_ENV;
const originalToken = process.env.DATA_SOURCE_ADMIN_TOKEN;

function authenticatedRequest(query = ""): Request {
  const login = new Request(
    "https://lens.example/api/data-sources/session",
    {
      method: "POST",
      headers: {
        Authorization: "Bearer discovery-secret",
        Origin: "https://lens.example",
      },
    },
  );
  const session = createDataSourceSessionCookie(login)._unsafeUnwrap();

  return new Request(
    `https://lens.example/api/data-sources/discovery${query}`,
    {
      headers: { Cookie: session.split(";")[0]! },
    },
  );
}

beforeEach(() => {
  Object.assign(process.env, {
    NODE_ENV: "production",
    DATA_SOURCE_ADMIN_TOKEN: "discovery-secret",
  });
  mocks.discover.mockReset();
  mocks.list.mockReset();
  mocks.list.mockReturnValue(okAsync({ sources: [] }));
});

afterEach(() => {
  Object.assign(process.env, {
    NODE_ENV: originalNodeEnv,
    DATA_SOURCE_ADMIN_TOKEN: originalToken,
  });
});

describe("GET /api/data-sources/discovery", () => {
  it("requires the existing authenticated read session", async () => {
    const response = await GET(
      new Request("https://lens.example/api/data-sources/discovery"),
    );

    expect(response.status).toBe(401);
    expect(mocks.discover).not.toHaveBeenCalled();
  });

  it("rejects unsafe database identifiers before ClickHouse is called", async () => {
    const response = await GET(
      authenticatedRequest("?database=default%3B%20DROP%20DATABASE%20default"),
    );

    expect(response.status).toBe(400);
    expect(mocks.discover).not.toHaveBeenCalled();
  });

  it("returns only the public discovery contract", async () => {
    mocks.discover.mockReturnValue(
      okAsync({
        database: "default",
        tables: [
          {
            database: "default",
            table: "trips",
            engine: "MergeTree",
            estimatedRows: 1_000,
            estimatedBytes: 8_192,
            columnCount: 1,
            modifiedAt: null,
            dateColumns: ["pickup_at"],
            columns: [
              { name: "pickup_at", type: "DateTime", position: 1 },
            ],
            registered: null,
          },
        ],
      }),
    );
    const response = await GET(authenticatedRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      database: "default",
      tables: [
        {
          database: "default",
          table: "trips",
          engine: "MergeTree",
          estimatedRows: 1_000,
          estimatedBytes: 8_192,
          columnCount: 1,
          modifiedAt: null,
          dateColumns: ["pickup_at"],
          columns: [
            { name: "pickup_at", type: "DateTime", position: 1 },
          ],
          registered: null,
        },
      ],
    });
    expect(JSON.stringify(body)).not.toContain("password");
    expect(JSON.stringify(body)).not.toContain("CLICKHOUSE_HOST");
  });

  it("does not expose ClickHouse errors, URLs, credentials, or query text", async () => {
    mocks.discover.mockReturnValue(
      errAsync({
        type: "table_discovery_error",
        message: "ClickHouse table discovery is unavailable",
        status: 503,
        cause: new Error(
          "https://admin:super-secret@clickhouse.example SELECT * FROM system.tables",
        ),
      }),
    );
    const response = await GET(authenticatedRequest());
    const text = await response.text();

    expect(response.status).toBe(503);
    expect(text).toContain("ClickHouse table discovery is unavailable");
    expect(text).not.toContain("super-secret");
    expect(text).not.toContain("clickhouse.example");
    expect(text).not.toContain("system.tables");
  });
});
