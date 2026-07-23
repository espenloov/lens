import axios from "axios";
import { okAsync } from "neverthrow";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { decodeSemanticFrame } from "@/lib/wasm/semantic-analysis";

import { loadSemanticAnalysis } from "./semantic-load";
import { semanticAnalysisRequestSchema } from "./semantic-plan";

vi.mock("axios", () => ({
  default: {
    isAxiosError: vi.fn(() => false),
    post: vi.fn(),
  },
}));

vi.mock("@/lib/wasm/semantic-analysis", () => ({
  decodeSemanticFrame: vi.fn(),
}));

const request = semanticAnalysisRequestSchema.parse({
  shape: "time_series",
  transform: "value",
  presentation: {
    valueLabel: "Average temperature",
    valueFormat: {
      kind: "number",
      maximumFractionDigits: 1,
    },
    categoryLabel: "Sensor",
    distributionMeasureFormat: null,
  },
  plan: {
    version: 1,
    dataset: "weather_readings",
    datasetVersion: 2,
    title: "Monthly temperature",
    explanation: "Average recorded temperature by month.",
    filters: {
      timeRange: null,
      dimensions: [],
      measures: [],
    },
    operation: "trend",
    metric: {
      kind: "measure",
      measure: "temperature",
      aggregation: "average",
    },
    interval: "month",
    splitBy: "sensor",
  },
});

describe("semantic analysis loader", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("posts the typed request and returns a visual model with pipeline timing", async () => {
    vi.mocked(axios.post).mockResolvedValue({
      data: new ArrayBuffer(16),
      headers: {
        "x-lens-arrow-contract": "time_series/v1",
        "x-clickhouse-query-id": "query-123",
      },
    });
    vi.mocked(decodeSemanticFrame).mockReturnValue(
      okAsync({
        frame: {
          kind: "time_series",
          columns: {
            rowCount: 1,
            seriesCount: 1,
            periodStarts: new Int32Array([19_723]),
            seriesIndexes: new Uint32Array([0]),
            values: new Float64Array([18.4]),
            observationCounts: new BigUint64Array([BigInt(240)]),
            seriesNames: ["Harbour"],
          },
          derived: null,
        },
        startupWaitMs: 0,
        decodeMs: 1.2,
        transformMs: 0,
      }),
    );

    const result = await loadSemanticAnalysis(request);

    expect(result.isOk()).toBe(true);
    expect(axios.post).toHaveBeenCalledWith(
      "/api/arrow/semantic",
      request,
      expect.objectContaining({ responseType: "arraybuffer" }),
    );
    expect(result._unsafeUnwrap()).toMatchObject({
      queryId: "query-123",
      arrowContract: "time_series/v1",
      arrowBytes: 16,
      wasmStartupMs: 0,
      rustDecodeMs: 1.2,
      rustTransformMs: 0,
      model: {
        kind: "trend",
        dataset: "weather_readings",
        valueLabel: "Average temperature",
        seriesNames: ["Harbour"],
      },
    });
  });

  it("rejects a mismatched Arrow contract before invoking WASM", async () => {
    vi.mocked(axios.post).mockResolvedValue({
      data: new ArrayBuffer(8),
      headers: {
        "x-lens-arrow-contract": "categorical/v1",
      },
    });

    const result = await loadSemanticAnalysis(request);

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr()).toMatchObject({
      kind: "semantic-fetch",
      message: "Expected Arrow contract time_series/v1",
    });
    expect(decodeSemanticFrame).not.toHaveBeenCalled();
  });
});
