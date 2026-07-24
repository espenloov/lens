import { describe, expect, it } from "vitest";

import { calculateTimeSeriesScale } from "./time-series-scale";

describe("calculateTimeSeriesScale", () => {
  it("holds extreme values at the edge without changing the raw domain", () => {
    const scale = calculateTimeSeriesScale(
      [180, 190, 195, 200, 205, 210, 215, 220, 225, 12_000],
      true,
    );

    expect(scale.fullMaximum).toBe(12_000);
    expect(scale.focusMaximum).toBe(225);
    expect(scale.clippedCount).toBe(1);
  });

  it("keeps an ordinary series on its complete scale", () => {
    const scale = calculateTimeSeriesScale(
      [100, 110, 120, 130, 140, 150, 160, 170],
      true,
    );

    expect(scale.focusMinimum).toBe(100);
    expect(scale.focusMaximum).toBe(170);
    expect(scale.clippedCount).toBe(0);
  });

  it("never focuses derived values when the caller disables it", () => {
    const scale = calculateTimeSeriesScale(
      [-100, -20, -10, 0, 10, 20, 30, 1_000],
      false,
    );

    expect(scale.focusMinimum).toBe(-100);
    expect(scale.focusMaximum).toBe(1_000);
    expect(scale.clippedCount).toBe(0);
  });
});
