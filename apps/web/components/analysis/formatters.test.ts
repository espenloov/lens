import { describe, expect, it } from "vitest";

import {
  formatBytes,
  formatDuration,
  formatPercentage,
  formatPrice,
  getPerformanceEvidence,
  getYearOverYearChange,
} from "./formatters";

describe("analysis formatters", () => {
  it("formats property values for a UK audience", () => {
    expect(formatPrice(270_667)).toBe("£270,667");
    expect(formatBytes(61_683_314)).toBe("61.7 MB");
    expect(formatDuration(299.301_773)).toBe("299 ms");
    expect(formatDuration(19_606)).toBe("19.6 s");
    expect(formatPercentage(3.45)).toBe("+3.5%");
  });

  it("calculates year-over-year price change", () => {
    const points = [
      { year: 2022, averagePrice: 200_000, transactionCount: 10 },
      { year: 2023, averagePrice: 180_000, transactionCount: 12 },
    ];

    expect(getYearOverYearChange(points, 0)).toBeNull();
    expect(getYearOverYearChange(points, 1)).toBe(-10);
  });

  it("separates measured performance from cold-start inference", () => {
    const evidence = getPerformanceEvidence({
      roundTripMs: 19_606,
      serverElapsedMs: 299.301_773,
      rowsRead: 28_919_900,
      bytesRead: 61_683_314,
    });

    expect(evidence.facts).toEqual([
      "28.9M rows read",
      "61.7 MB scanned",
      "299 ms ClickHouse execution",
      "19.6 s end-to-end",
    ]);
    expect(evidence.outsideQueryInference).toBe(
      "19.3 s occurred outside query execution; likely service wake-up or network latency.",
    );
  });

  it("does not infer a wake-up on a normal warm query", () => {
    const evidence = getPerformanceEvidence({
      roundTripMs: 459,
      serverElapsedMs: 299,
      rowsRead: 28_919_900,
      bytesRead: 61_683_314,
    });

    expect(evidence.outsideQueryInference).toBeNull();
  });
});
