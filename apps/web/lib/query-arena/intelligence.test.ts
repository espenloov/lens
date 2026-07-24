import { describe, expect, it } from "vitest";

import {
  summarizePerformanceLanes,
  type PerformanceLane,
} from "./intelligence";

function lane(
  arenaId: string,
  strategy: PerformanceLane["strategy"],
  medianMs: number,
  options: {
    readonly winner?: boolean;
    readonly fingerprint?: string;
    readonly fingerprintCount?: number;
  } = {},
): PerformanceLane {
  return {
    arenaId,
    strategy,
    winner: options.winner ?? false,
    medianMs,
    fingerprint: options.fingerprint ?? "a".repeat(64),
    fingerprintCount: options.fingerprintCount ?? 1,
  };
}

describe("summarizePerformanceLanes", () => {
  it("reports verified races and measured savings", () => {
    const summary = summarizePerformanceLanes([
      lane("race-1", "baseline", 200),
      lane("race-1", "prewhere", 80, { winner: true }),
      lane("race-2", "baseline", 100),
      lane("race-2", "prewhere", 60, { winner: true }),
    ]);

    expect(summary).toEqual({
      verifiedRaces: 2,
      baselineP50Ms: 150,
      baselineP95Ms: 195,
      winnerP50Ms: 70,
      winnerP95Ms: 79,
      accumulatedServerMsSaved: 160,
    });
  });

  it("excludes races whose Rust fingerprints disagree", () => {
    const summary = summarizePerformanceLanes([
      lane("unsafe", "baseline", 100),
      lane("unsafe", "prewhere", 20, {
        winner: true,
        fingerprint: "b".repeat(64),
      }),
    ]);

    expect(summary).toEqual({
      verifiedRaces: 0,
      baselineP50Ms: null,
      baselineP95Ms: null,
      winnerP50Ms: null,
      winnerP95Ms: null,
      accumulatedServerMsSaved: 0,
    });
  });

  it("excludes unstable lanes with different repeated results", () => {
    const summary = summarizePerformanceLanes([
      lane("unstable", "baseline", 100, { fingerprintCount: 2 }),
      lane("unstable", "prewhere", 20, { winner: true }),
    ]);

    expect(summary.verifiedRaces).toBe(0);
  });

  it("never reports negative savings when baseline wins", () => {
    const summary = summarizePerformanceLanes([
      lane("baseline-wins", "baseline", 40, { winner: true }),
      lane("baseline-wins", "prewhere", 60),
    ]);

    expect(summary.accumulatedServerMsSaved).toBe(0);
    expect(summary.winnerP50Ms).toBe(40);
  });
});
