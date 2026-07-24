import { beforeEach, describe, expect, it, vi } from "vitest";

const clickHouse = vi.hoisted(() => ({
  query: vi.fn(),
}));

vi.mock("../../clickhouse/client", () => ({
  getClickHouseClient: () => clickHouse,
}));

import { loadTuningEvidence } from "./evidence";

const identity = {
  executionSignature: "a".repeat(64),
  semanticFamilyHash: "b".repeat(64),
  dataset: "uk_price_paid",
  datasetVersion: 1,
};

describe("loadTuningEvidence", () => {
  beforeEach(() => {
    clickHouse.query.mockReset();
  });

  it("loads one winner median per arena for the exact execution signature", async () => {
    clickHouse.query.mockResolvedValue({
      json: async () => [
        {
          observed_arenas: "3",
          verified_trials: "9",
          p95_server_elapsed_ms: 420,
          median_rows_read: "28919900",
          first_observed_at: "2026-07-20T10:00:00.000Z",
          last_observed_at: "2026-07-23T10:00:00.000Z",
        },
      ],
    });

    const result = await loadTuningEvidence(identity);
    const request = clickHouse.query.mock.calls[0]?.[0];

    expect(result._unsafeUnwrap()).toMatchObject({
      analysisSignature: identity.executionSignature,
      semanticFamilyHash: identity.semanticFamilyHash,
      observedArenas: 3,
      verifiedTrials: 9,
      p95ServerElapsedMs: 420,
      medianRowsRead: 28_919_900,
    });
    expect(request.query_params).toEqual({
      analysisSignature: identity.executionSignature,
      dataset: identity.dataset,
      datasetVersion: identity.datasetVersion,
    });
    expect(request.query).toContain(
      "analysis_signature = {analysisSignature:FixedString(64)}",
    );
    expect(request.query).toContain("winner = 1");
    expect(request.query).toContain("GROUP BY arena_id");
    expect(request.query).not.toContain(
      "semantic_family_hash = {semanticFamilyHash",
    );
  });
});
