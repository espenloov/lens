import { describe, expect, it } from "vitest";

import { calculateTimeSeriesPerformance } from "./performance";

describe("calculateTimeSeriesPerformance", () => {
  it("keeps transport, WASM startup, and Rust decode separate", () => {
    const result = calculateTimeSeriesPerformance({
      requestStartedAt: 100,
      responseReceivedAt: 546,
      wasm: {
        startupWaitMs: 68.8,
        decodeMs: 0.2,
        wasReady: false,
      },
    });

    expect(result).toEqual({
      roundTripMs: 446,
      wasmStartupWaitMs: 68.8,
      rustDecodeMs: 0.2,
      wasmWasReady: false,
    });
  });

  it("reports no startup wait after the runtime is preloaded", () => {
    const result = calculateTimeSeriesPerformance({
      requestStartedAt: 200,
      responseReceivedAt: 650,
      wasm: {
        startupWaitMs: 0,
        decodeMs: 0.14,
        wasReady: true,
      },
    });

    expect(result.wasmStartupWaitMs).toBe(0);
    expect(result.wasmWasReady).toBe(true);
    expect(result.rustDecodeMs).toBe(0.14);
  });
});
