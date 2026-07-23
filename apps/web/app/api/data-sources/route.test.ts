import { errAsync, okAsync } from "neverthrow";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  deleteSource: vi.fn(),
  list: vi.fn(),
  select: vi.fn(),
}));

vi.mock("../../../lib/data-sources/registry", () => ({
  deleteRegisteredDataSource: mocks.deleteSource,
  listDataSources: mocks.list,
  selectDataSource: mocks.select,
}));

import { DELETE } from "./route";

const source = {
  slug: "taxi_trips",
  displayName: "Taxi trips",
  version: 1,
  contractVersion: "analytical_table/v1" as const,
  status: "compatible" as const,
  database: "default",
  table: "trips",
  dateFrom: "2024-01-01",
  dateTo: "2024-12-31",
  rowCount: 1_000,
  supportsPrewhere: false,
  queryArenaEligible: true,
  capabilities: {
    operations: {
      trend: true,
      comparison: true,
      ranking: true,
      distribution: true,
      composition: true,
      heatmap: false,
      anomaly: true,
      exploration: false,
    },
    measureKeys: ["fare"],
    dimensionKeys: ["borough"],
    compactDimensionKeys: [],
    geographyKeys: ["borough"],
    timeGranularities: ["month"],
  },
  selected: false,
  builtin: false,
};

function deletionRequest(slug: string): Request {
  return new Request("http://localhost:3000/api/data-sources", {
    body: JSON.stringify({ slug }),
    headers: {
      "Content-Type": "application/json",
      Origin: "http://localhost:3000",
    },
    method: "DELETE",
  });
}

beforeEach(() => {
  mocks.deleteSource.mockReset();
  mocks.list.mockReset();
  mocks.select.mockReset();
});

describe("DELETE /api/data-sources", () => {
  it("deletes the exact registered source", async () => {
    mocks.deleteSource.mockReturnValue(okAsync(source));

    const response = await DELETE(deletionRequest("taxi_trips"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(source);
    expect(mocks.deleteSource).toHaveBeenCalledExactlyOnceWith("taxi_trips");
  });

  it("protects the built-in source", async () => {
    const response = await DELETE(deletionRequest("uk_price_paid"));

    expect(response.status).toBe(400);
    expect(mocks.deleteSource).not.toHaveBeenCalled();
  });

  it("reports registry failures without claiming the source was deleted", async () => {
    mocks.deleteSource.mockReturnValue(
      errAsync({
        type: "data_source_registry_error",
        message: "PostgreSQL is unavailable",
        cause: new Error("offline"),
      }),
    );

    const response = await DELETE(deletionRequest("taxi_trips"));

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      type: "data_source_registry_error",
      message: "PostgreSQL is unavailable",
    });
  });
});
