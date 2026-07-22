import type { TimeSeriesWasmTiming } from "@/lib/wasm/time-series";

export type TimeSeriesPerformance = {
  readonly roundTripMs: number;
  readonly wasmStartupWaitMs: number;
  readonly rustDecodeMs: number;
  readonly wasmWasReady: boolean;
};

type TimeSeriesPerformanceInput = {
  readonly requestStartedAt: number;
  readonly responseReceivedAt: number;
  readonly wasm: TimeSeriesWasmTiming;
};

export function calculateTimeSeriesPerformance({
  requestStartedAt,
  responseReceivedAt,
  wasm,
}: TimeSeriesPerformanceInput): TimeSeriesPerformance {
  return {
    roundTripMs: Math.max(0, responseReceivedAt - requestStartedAt),
    wasmStartupWaitMs: wasm.startupWaitMs,
    rustDecodeMs: wasm.decodeMs,
    wasmWasReady: wasm.wasReady,
  };
}
