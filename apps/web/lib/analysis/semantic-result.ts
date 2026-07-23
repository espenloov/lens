import { err, ok, type Result } from "neverthrow";

import type { SemanticFrame } from "@/lib/wasm/semantic-analysis";

import type { SemanticAnalysisRequest } from "./semantic-plan";

type AnalyticalFormat =
  SemanticAnalysisRequest["presentation"]["valueFormat"];

type VisualBase = {
  readonly dataset: string;
  readonly datasetVersion: number;
  readonly title: string;
  readonly explanation: string;
  readonly valueLabel: string;
  readonly valueFormat: AnalyticalFormat;
  readonly categoryLabel: string | null;
};

export type SemanticSeriesPoint = {
  readonly periodStart: number;
  readonly seriesIndex: number;
  readonly value: number;
  readonly rawValue: number;
  readonly observationCount: bigint;
  readonly valid: boolean;
};

export type SemanticCategoryItem = {
  readonly label: string;
  readonly value: number;
  readonly rawValue: number;
  readonly observationCount: bigint;
};

export type TrendVisualModel = VisualBase & {
  readonly kind: "trend";
  readonly interval: "year" | "quarter" | "month";
  readonly seriesNames: readonly string[];
  readonly points: readonly SemanticSeriesPoint[];
};

export type ComparisonVisualModel = VisualBase & {
  readonly kind: "comparison";
  readonly layout: "categorical" | "time_series";
  readonly interval: "year" | "quarter" | "month" | null;
  readonly seriesNames: readonly string[];
  readonly items: readonly SemanticCategoryItem[];
  readonly points: readonly SemanticSeriesPoint[];
};

export type RankingVisualModel = VisualBase & {
  readonly kind: "ranking";
  readonly order: "ascending" | "descending";
  readonly items: readonly SemanticCategoryItem[];
};

export type DistributionVisualModel = VisualBase & {
  readonly kind: "distribution";
  readonly measureFormat: AnalyticalFormat;
  readonly seriesNames: readonly string[];
  readonly bins: readonly {
    readonly start: number;
    readonly end: number;
    readonly seriesIndex: number;
    readonly value: number;
    readonly observationCount: bigint;
  }[];
};

export type CompositionVisualModel = VisualBase & {
  readonly kind: "composition";
  readonly layout: "categorical" | "time_series";
  readonly interval: "year" | "quarter" | "month" | null;
  readonly seriesNames: readonly string[];
  readonly items: readonly SemanticCategoryItem[];
  readonly points: readonly SemanticSeriesPoint[];
};

export type AnomalyVisualModel = VisualBase & {
  readonly kind: "anomaly";
  readonly interval: "year" | "month";
  readonly threshold: number;
  readonly seriesNames: readonly string[];
  readonly points: readonly {
    readonly periodStart: number;
    readonly seriesIndex: number;
    readonly value: number;
    readonly expected: number;
    readonly score: number;
    readonly observationCount: bigint;
    readonly valid: boolean;
    readonly flagged: boolean;
  }[];
};

export type SemanticVisualModel =
  | TrendVisualModel
  | ComparisonVisualModel
  | RankingVisualModel
  | DistributionVisualModel
  | CompositionVisualModel
  | AnomalyVisualModel;

export type SemanticAdapterError = {
  readonly kind: "semantic-adapter";
  readonly message: string;
};

function adapterError(message: string): SemanticAdapterError {
  return { kind: "semantic-adapter", message };
}

function baseModel(request: SemanticAnalysisRequest): VisualBase {
  return {
    dataset: request.plan.dataset,
    datasetVersion: request.plan.datasetVersion,
    title: request.plan.title,
    explanation: request.plan.explanation,
    valueLabel: request.presentation.valueLabel,
    valueFormat: request.presentation.valueFormat,
    categoryLabel: request.presentation.categoryLabel,
  };
}

function categoryItems(
  frame: Extract<SemanticFrame, { kind: "categorical" }>,
): Result<readonly SemanticCategoryItem[], SemanticAdapterError> {
  if (
    frame.categories.length !== frame.values.length ||
    frame.rawValues.length !== frame.values.length ||
    frame.observationCounts.length !== frame.values.length
  ) {
    return err(adapterError("The categorical columns have different lengths"));
  }

  return ok(
    frame.categories.map((label, index) => ({
      label,
      value: frame.values[index]!,
      rawValue: frame.rawValues[index]!,
      observationCount: frame.observationCounts[index]!,
    })),
  );
}

function seriesPoints(
  frame: Extract<SemanticFrame, { kind: "time_series" }>,
): Result<readonly SemanticSeriesPoint[], SemanticAdapterError> {
  const { columns, derived } = frame;
  const rowCount = columns.values.length;

  if (
    columns.periodStarts.length !== rowCount ||
    columns.seriesIndexes.length !== rowCount ||
    columns.observationCounts.length !== rowCount
  ) {
    return err(adapterError("The time-series columns have different lengths"));
  }

  if (
    derived !== null &&
    derived.kind !== "anomaly_score" &&
    (derived.values.length !== rowCount ||
      derived.validity.length !== rowCount)
  ) {
    return err(adapterError("The derived time-series columns are incomplete"));
  }

  const values =
    derived !== null && derived.kind !== "anomaly_score"
      ? derived.values
      : columns.values;
  const validity =
    derived !== null && derived.kind !== "anomaly_score"
      ? derived.validity
      : null;

  return ok(
    Array.from({ length: rowCount }, (_, index) => ({
      periodStart: columns.periodStarts[index]!,
      seriesIndex: columns.seriesIndexes[index]!,
      value: values[index]!,
      rawValue: columns.values[index]!,
      observationCount: columns.observationCounts[index]!,
      valid: validity === null || validity[index] === 1,
    })),
  );
}

function validateSeriesIndexes(
  seriesNames: readonly string[],
  indexes: Uint32Array,
): Result<void, SemanticAdapterError> {
  for (const index of indexes) {
    if (index >= seriesNames.length) {
      return err(adapterError(`Series index ${index} has no label`));
    }
  }

  return ok(undefined);
}

export function toSemanticVisualModel(
  request: SemanticAnalysisRequest,
  frame: SemanticFrame,
): Result<SemanticVisualModel, SemanticAdapterError> {
  const base = baseModel(request);
  const plan = request.plan;

  switch (plan.operation) {
    case "trend": {
      if (frame.kind !== "time_series" || request.transform !== "value") {
        return err(adapterError("A trend requires a value time series"));
      }

      return validateSeriesIndexes(
        frame.columns.seriesNames,
        frame.columns.seriesIndexes,
      ).andThen(() =>
        seriesPoints(frame).map((points) => ({
          ...base,
          kind: "trend" as const,
          interval: plan.interval,
          seriesNames: frame.columns.seriesNames,
          points,
        })),
      );
    }

    case "comparison": {
      if (plan.interval === null) {
        if (frame.kind !== "categorical" || request.transform !== "value") {
          return err(
            adapterError("A categorical comparison requires category values"),
          );
        }

        return categoryItems(frame).map((items) => ({
          ...base,
          kind: "comparison" as const,
          layout: "categorical" as const,
          interval: null,
          seriesNames: [],
          items,
          points: [],
        }));
      }

      if (frame.kind !== "time_series" || request.transform !== "value") {
        return err(
          adapterError("A time comparison requires a value time series"),
        );
      }

      return validateSeriesIndexes(
        frame.columns.seriesNames,
        frame.columns.seriesIndexes,
      ).andThen(() =>
        seriesPoints(frame).map((points) => ({
          ...base,
          kind: "comparison" as const,
          layout: "time_series" as const,
          interval: plan.interval,
          seriesNames: frame.columns.seriesNames,
          items: [],
          points,
        })),
      );
    }

    case "ranking": {
      if (frame.kind !== "categorical" || request.transform !== "value") {
        return err(adapterError("A ranking requires category values"));
      }

      return categoryItems(frame).map((items) => ({
        ...base,
        kind: "ranking" as const,
        order: plan.order,
        items,
      }));
    }

    case "distribution": {
      if (
        frame.kind !== "histogram" ||
        request.presentation.distributionMeasureFormat === null
      ) {
        return err(
          adapterError(
            "A distribution requires histogram values and a measure format",
          ),
        );
      }

      const rowCount = frame.values.length;

      if (
        frame.binStarts.length !== rowCount ||
        frame.binEnds.length !== rowCount ||
        frame.seriesIndexes.length !== rowCount ||
        frame.observationCounts.length !== rowCount
      ) {
        return err(
          adapterError("The histogram columns have different lengths"),
        );
      }

      return validateSeriesIndexes(
        frame.seriesNames,
        frame.seriesIndexes,
      ).map(() => ({
        ...base,
        kind: "distribution" as const,
        measureFormat: request.presentation.distributionMeasureFormat!,
        seriesNames: frame.seriesNames,
        bins: Array.from({ length: rowCount }, (_, index) => ({
          start: frame.binStarts[index]!,
          end: frame.binEnds[index]!,
          seriesIndex: frame.seriesIndexes[index]!,
          value: frame.values[index]!,
          observationCount: frame.observationCounts[index]!,
        })),
      }));
    }

    case "composition": {
      if (request.transform !== "share") {
        return err(adapterError("A composition requires the share transform"));
      }

      if (plan.interval === null) {
        if (frame.kind !== "categorical") {
          return err(
            adapterError("A categorical composition requires category values"),
          );
        }

        return categoryItems(frame).map((items) => ({
          ...base,
          kind: "composition" as const,
          layout: "categorical" as const,
          interval: null,
          seriesNames: [],
          items,
          points: [],
        }));
      }

      if (frame.kind !== "time_series") {
        return err(
          adapterError("A composition over time requires a time series"),
        );
      }

      return validateSeriesIndexes(
        frame.columns.seriesNames,
        frame.columns.seriesIndexes,
      ).andThen(() =>
        seriesPoints(frame).map((points) => ({
          ...base,
          kind: "composition" as const,
          layout: "time_series" as const,
          interval: plan.interval,
          seriesNames: frame.columns.seriesNames,
          items: [],
          points,
        })),
      );
    }

    case "anomaly": {
      if (
        frame.kind !== "time_series" ||
        frame.derived?.kind !== "anomaly_score"
      ) {
        return err(
          adapterError("An anomaly analysis requires anomaly score columns"),
        );
      }

      const { columns, derived } = frame;
      const rowCount = columns.values.length;

      if (
        columns.periodStarts.length !== rowCount ||
        columns.seriesIndexes.length !== rowCount ||
        columns.observationCounts.length !== rowCount ||
        derived.expected.length !== rowCount ||
        derived.scores.length !== rowCount ||
        derived.validity.length !== rowCount ||
        derived.flags.length !== rowCount
      ) {
        return err(adapterError("The anomaly columns have different lengths"));
      }

      return validateSeriesIndexes(
        columns.seriesNames,
        columns.seriesIndexes,
      ).map(() => ({
        ...base,
        kind: "anomaly" as const,
        interval: plan.interval,
        threshold: plan.threshold,
        seriesNames: columns.seriesNames,
        points: Array.from({ length: rowCount }, (_, index) => ({
          periodStart: columns.periodStarts[index]!,
          seriesIndex: columns.seriesIndexes[index]!,
          value: columns.values[index]!,
          expected: derived.expected[index]!,
          score: derived.scores[index]!,
          observationCount: columns.observationCounts[index]!,
          valid: derived.validity[index] === 1,
          flagged: derived.flags[index] === 1,
        })),
      }));
    }
  }
}

export function formatSemanticValue(
  value: number,
  format: AnalyticalFormat,
): string {
  const options: Intl.NumberFormatOptions = {
    maximumFractionDigits: format.maximumFractionDigits,
  };

  switch (format.kind) {
    case "number":
      return new Intl.NumberFormat("en-GB", options).format(value);
    case "currency":
      return new Intl.NumberFormat("en-GB", {
        ...options,
        style: "currency",
        currency: format.currency,
      }).format(value);
    case "percent":
      return `${new Intl.NumberFormat("en-GB", options).format(value)}%`;
    case "duration":
      return `${new Intl.NumberFormat("en-GB", options).format(value)} ${
        format.unit === "milliseconds" ? "ms" : "s"
      }`;
  }
}
