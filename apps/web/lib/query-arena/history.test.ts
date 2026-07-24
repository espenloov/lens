import { describe, expect, it } from "vitest";

import { toPerformanceHistoryRows } from "./history";

describe("toPerformanceHistoryRows", () => {
  it("maps successful trials and failed lanes", () => {
    const rows = toPerformanceHistoryRows({
      arenaId: "9fde1811-bdec-40ca-a231-5ff68461b84a",
      signature: "a".repeat(64),
      semanticFamilyHash: "c".repeat(64),
      dataset: "uk_price_paid",
      datasetVersion: 1,
      winner: "prewhere",
      recordedAt: "2026-07-22T12:00:00.000Z",
      candidates: [
        {
          status: "verified",
          strategy: "prewhere",
          medianMetrics: {
            queryId: "query-1",
            roundTripMs: 120,
            serverElapsedMs: 80,
            rowsRead: 100,
            bytesRead: 800,
            arrowBytes: 512,
          },
          fingerprint: {
            algorithm: "sha256-v1",
            digest: "b".repeat(64),
            rowCount: 2,
          },
          trials: Array.from({ length: 3 }, (_, index) => ({
            metrics: {
              queryId: `query-${index + 1}`,
              roundTripMs: 120 + index,
              serverElapsedMs: 80 + index,
              rowsRead: 100,
              bytesRead: 800,
              arrowBytes: 512,
            },
            fingerprint: {
              algorithm: "sha256-v1" as const,
              digest: "b".repeat(64),
              rowCount: 2,
            },
          })),
        },
        {
          status: "failed",
          strategy: "baseline",
          message: "timeout",
        },
      ],
    });

    expect(rows).toHaveLength(4);
    expect(rows[0]).toMatchObject({
      strategy: "prewhere",
      winner: true,
      outcome: "verified",
    });
    expect(rows[3]).toMatchObject({
      strategy: "baseline",
      outcome: "failed",
      error_message: "timeout",
      query_id: null,
    });
  });
});
