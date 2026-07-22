import { describe, expect, it } from "vitest";

import type { QueryStrategy, StrategyBenchmark } from "./contracts";
import { evaluateQueryArena } from "./result";

const strategies: QueryStrategy[] = ["baseline", "prewhere"];

function benchmark(
  strategy: QueryStrategy,
  serverElapsedMs: number,
  digest = "a".repeat(64),
): StrategyBenchmark {
  const trials = Array.from({ length: 3 }, (_, index) => ({
    metrics: {
      queryId: `${strategy}-${index}`,
      roundTripMs: serverElapsedMs + 20 + index,
      serverElapsedMs: serverElapsedMs + index,
      rowsRead: 100,
      bytesRead: 800,
      arrowBytes: 512,
    },
    fingerprint: {
      algorithm: "sha256-v1" as const,
      digest,
      rowCount: 2,
    },
  }));

  return {
    strategy,
    trials,
    medianMetrics: trials[1].metrics,
    fingerprint: trials[0].fingerprint,
  };
}

describe("evaluateQueryArena", () => {
  it("selects the fastest Rust-verified strategy", () => {
    const evaluation = evaluateQueryArena(strategies, [
      { ok: true, output: benchmark("baseline", 100) },
      { ok: true, output: benchmark("prewhere", 50) },
    ]);

    expect(evaluation.verified).toBe(true);
    expect(evaluation.winner).toBe("prewhere");
    expect(evaluation.speedup).toBeCloseTo(101 / 51);
  });

  it("refuses to select a faster mismatched result", () => {
    const evaluation = evaluateQueryArena(strategies, [
      { ok: true, output: benchmark("baseline", 100) },
      {
        ok: true,
        output: benchmark("prewhere", 20, "b".repeat(64)),
      },
    ]);

    expect(evaluation.verified).toBe(false);
    expect(evaluation.winner).toBeNull();
    expect(evaluation.candidates[1]?.status).toBe("mismatch");
  });

  it("does not promote a partial race", () => {
    const evaluation = evaluateQueryArena(strategies, [
      { ok: true, output: benchmark("baseline", 100) },
      { ok: false, error: new Error("timeout") },
    ]);

    expect(evaluation.verified).toBe(false);
    expect(evaluation.winner).toBeNull();
    expect(evaluation.candidates[1]).toMatchObject({
      status: "failed",
      strategy: "prewhere",
    });
  });
});
