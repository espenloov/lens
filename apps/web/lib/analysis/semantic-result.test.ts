import { describe, expect, it } from "vitest";

import type { SemanticFrame } from "@/lib/wasm/semantic-analysis";

import { semanticAnalysisRequestSchema } from "./semantic-plan";
import {
  formatSemanticValue,
  toSemanticVisualModel,
} from "./semantic-result";

const filters = {
  timeRange: null,
  dimensions: [],
  measures: [],
};

function timeSeries(
  derived: Extract<SemanticFrame, { kind: "time_series" }>["derived"] = null,
): Extract<SemanticFrame, { kind: "time_series" }> {
  return {
    kind: "time_series",
    columns: {
      rowCount: 2,
      seriesCount: 1,
      periodStarts: new Int32Array([19_723, 19_754]),
      seriesIndexes: new Uint32Array([0, 0]),
      values: new Float64Array([42.5, 47.25]),
      observationCounts: new BigUint64Array([BigInt(120), BigInt(135)]),
      seriesNames: ["All routes"],
    },
    derived,
  };
}

function categorical(
  values = new Float64Array([62.5, 37.5]),
): Extract<SemanticFrame, { kind: "categorical" }> {
  return {
    kind: "categorical",
    categories: ["Rail", "Bus"],
    values,
    rawValues: new Float64Array([250, 150]),
    observationCounts: new BigUint64Array([BigInt(250), BigInt(150)]),
  };
}

const valuePresentation = {
  valueLabel: "Average delay",
  valueFormat: {
    kind: "duration" as const,
    unit: "seconds" as const,
    maximumFractionDigits: 1,
  },
  categoryLabel: "Transport mode",
  distributionMeasureFormat: null,
};

describe("semantic visual result adapter", () => {
  it("creates a property-neutral trend from typed time-series columns", () => {
    const request = semanticAnalysisRequestSchema.parse({
      shape: "time_series",
      transform: "value",
      presentation: valuePresentation,
      plan: {
        version: 1,
        dataset: "city_mobility",
        datasetVersion: 3,
        title: "Average delay by month",
        explanation: "Monthly delay across the transport network.",
        filters,
        operation: "trend",
        metric: {
          kind: "measure",
          measure: "delay_seconds",
          aggregation: "average",
        },
        interval: "month",
        splitBy: null,
      },
    });
    const result = toSemanticVisualModel(request, timeSeries());

    expect(result.isOk()).toBe(true);
    const model = result._unsafeUnwrap();

    expect(model).toMatchObject({
      kind: "trend",
      dataset: "city_mobility",
      datasetVersion: 3,
      valueLabel: "Average delay",
      categoryLabel: "Transport mode",
      interval: "month",
      seriesNames: ["All routes"],
    });
    expect(model.kind === "trend" ? model.points[1] : null).toEqual({
      periodStart: 19_754,
      seriesIndex: 0,
      value: 47.25,
      rawValue: 47.25,
      observationCount: BigInt(135),
      valid: true,
    });
  });

  it("creates comparison and ranking models from the same category contract", () => {
    const comparison = semanticAnalysisRequestSchema.parse({
      shape: "categorical",
      transform: "value",
      presentation: valuePresentation,
      plan: {
        version: 1,
        dataset: "city_mobility",
        datasetVersion: 3,
        title: "Delay by transport mode",
        explanation: "Compare average delay across modes.",
        filters,
        operation: "comparison",
        metric: {
          kind: "measure",
          measure: "delay_seconds",
          aggregation: "average",
        },
        compareBy: "transport_mode",
        interval: null,
      },
    });
    const ranking = semanticAnalysisRequestSchema.parse({
      shape: "categorical",
      transform: "value",
      presentation: valuePresentation,
      plan: {
        version: 1,
        dataset: "city_mobility",
        datasetVersion: 3,
        title: "Most delayed modes",
        explanation: "Rank modes by their average delay.",
        filters,
        operation: "ranking",
        metric: {
          kind: "measure",
          measure: "delay_seconds",
          aggregation: "average",
        },
        rankBy: "transport_mode",
        order: "descending",
        limit: 10,
      },
    });

    expect(
      toSemanticVisualModel(comparison, categorical())._unsafeUnwrap(),
    ).toMatchObject({
      kind: "comparison",
      layout: "categorical",
      items: [
        { label: "Rail", value: 62.5, observationCount: BigInt(250) },
        { label: "Bus", value: 37.5, observationCount: BigInt(150) },
      ],
    });
    expect(
      toSemanticVisualModel(ranking, categorical())._unsafeUnwrap(),
    ).toMatchObject({
      kind: "ranking",
      order: "descending",
      items: [{ label: "Rail" }, { label: "Bus" }],
    });
  });

  it("keeps histogram counts separate from the manifest measure format", () => {
    const request = semanticAnalysisRequestSchema.parse({
      shape: "histogram",
      transform: "value",
      presentation: {
        valueLabel: "Trips",
        valueFormat: { kind: "number", maximumFractionDigits: 0 },
        categoryLabel: "Transport mode",
        distributionMeasureFormat: {
          kind: "currency",
          currency: "EUR",
          maximumFractionDigits: 2,
        },
      },
      plan: {
        version: 1,
        dataset: "city_mobility",
        datasetVersion: 3,
        title: "Fare distribution",
        explanation: "Distribution of recorded fares.",
        filters,
        operation: "distribution",
        measure: "fare",
        splitBy: "transport_mode",
        bucketMinimum: 0,
        bucketWidth: 5,
        maximumBins: 20,
      },
    });
    const frame: SemanticFrame = {
      kind: "histogram",
      binStarts: new Float64Array([0, 5]),
      binEnds: new Float64Array([5, 10]),
      seriesIndexes: new Uint32Array([0, 0]),
      seriesNames: ["Rail"],
      values: new Float64Array([88, 41]),
      observationCounts: new BigUint64Array([BigInt(88), BigInt(41)]),
    };
    const model = toSemanticVisualModel(request, frame)._unsafeUnwrap();

    expect(model).toMatchObject({
      kind: "distribution",
      valueFormat: { kind: "number" },
      measureFormat: { kind: "currency", currency: "EUR" },
      bins: [
        { start: 0, end: 5, value: 88 },
        { start: 5, end: 10, value: 41 },
      ],
    });
  });

  it("creates categorical composition models with percentage-point values", () => {
    const request = semanticAnalysisRequestSchema.parse({
      shape: "categorical",
      transform: "share",
      presentation: {
        valueLabel: "Share",
        valueFormat: { kind: "percent", maximumFractionDigits: 1 },
        categoryLabel: "Transport mode",
        distributionMeasureFormat: null,
      },
      plan: {
        version: 1,
        dataset: "city_mobility",
        datasetVersion: 3,
        title: "Trips by mode",
        explanation: "Share of trips for each mode.",
        filters,
        operation: "composition",
        dimension: "transport_mode",
        interval: null,
      },
    });
    const model = toSemanticVisualModel(
      request,
      categorical(),
    )._unsafeUnwrap();

    expect(model).toMatchObject({
      kind: "composition",
      layout: "categorical",
      valueFormat: { kind: "percent", maximumFractionDigits: 1 },
      items: [
        { label: "Rail", value: 62.5, rawValue: 250 },
        { label: "Bus", value: 37.5, rawValue: 150 },
      ],
    });
  });

  it("creates anomaly models with Rust-derived expectations and flags", () => {
    const request = semanticAnalysisRequestSchema.parse({
      shape: "time_series",
      transform: "anomaly_score",
      presentation: valuePresentation,
      plan: {
        version: 1,
        dataset: "city_mobility",
        datasetVersion: 3,
        title: "Unusual monthly delays",
        explanation: "Flag unusual movements in average delay.",
        filters,
        operation: "anomaly",
        metric: {
          kind: "measure",
          measure: "delay_seconds",
          aggregation: "average",
        },
        interval: "month",
        splitBy: null,
        threshold: 2.5,
      },
    });
    const frame = timeSeries({
      kind: "anomaly_score",
      expected: new Float64Array([41, 42]),
      scores: new Float64Array([0.2, 3.1]),
      validity: new Uint8Array([1, 1]),
      flags: new Uint8Array([0, 1]),
    });
    const model = toSemanticVisualModel(request, frame)._unsafeUnwrap();

    expect(model).toMatchObject({
      kind: "anomaly",
      threshold: 2.5,
      points: [
        { expected: 41, score: 0.2, flagged: false },
        { expected: 42, score: 3.1, flagged: true },
      ],
    });
  });

  it("fails closed when the operation and Arrow shape do not agree", () => {
    const request = semanticAnalysisRequestSchema.parse({
      shape: "time_series",
      transform: "value",
      presentation: valuePresentation,
      plan: {
        version: 1,
        dataset: "city_mobility",
        datasetVersion: 3,
        title: "Average delay by month",
        explanation: "Monthly delay across the transport network.",
        filters,
        operation: "trend",
        metric: { kind: "row_count" },
        interval: "month",
        splitBy: null,
      },
    });
    const result = toSemanticVisualModel(request, categorical());

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().message).toContain("trend");
  });
});

describe("semantic value formatting", () => {
  it("uses manifest formats without property-specific assumptions", () => {
    expect(
      formatSemanticValue(12.345, {
        kind: "currency",
        currency: "EUR",
        maximumFractionDigits: 2,
      }),
    ).toContain("12.35");
    expect(
      formatSemanticValue(62.5, {
        kind: "percent",
        maximumFractionDigits: 1,
      }),
    ).toBe("62.5%");
    expect(
      formatSemanticValue(47.25, {
        kind: "duration",
        unit: "seconds",
        maximumFractionDigits: 1,
      }),
    ).toBe("47.3 s");
  });
});
