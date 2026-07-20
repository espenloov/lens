import type {
  YearlyAveragePricePoint,
  YearlyAveragePriceResult,
} from "@/lib/analysis/results";

const gbpFormatter = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
  maximumFractionDigits: 0,
});

const compactGbpFormatter = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
  notation: "compact",
  maximumFractionDigits: 1,
});

const countFormatter = new Intl.NumberFormat("en-GB");

export function formatPrice(value: number): string {
  return gbpFormatter.format(value);
}

export function formatCompactPrice(value: number): string {
  return compactGbpFormatter.format(value);
}

export function formatCount(value: number): string {
  return countFormatter.format(value);
}

export function formatCompactCount(value: number): string {
  if (value < 1_000) {
    return formatCount(value);
  }

  const units = ["K", "M", "B", "T"] as const;
  let amount = value;
  let unitIndex = -1;

  do {
    amount /= 1_000;
    unitIndex += 1;
  } while (amount >= 1_000 && unitIndex < units.length - 1);

  return `${amount.toFixed(1).replace(/\.0$/, "")}${units[unitIndex]}`;
}

export function formatBytes(value: number): string {
  if (value < 1_000) {
    return `${value} B`;
  }

  const units = ["kB", "MB", "GB", "TB"] as const;
  let amount = value;
  let unitIndex = -1;

  do {
    amount /= 1_000;
    unitIndex += 1;
  } while (amount >= 1_000 && unitIndex < units.length - 1);

  const maximumFractionDigits = amount >= 100 ? 0 : 1;

  return `${amount.toFixed(maximumFractionDigits)} ${units[unitIndex]}`;
}

export function formatDuration(milliseconds: number): string {
  if (milliseconds < 1_000) {
    return `${Math.round(milliseconds)} ms`;
  }

  return `${(milliseconds / 1_000).toFixed(1)} s`;
}

export function getYearOverYearChange(
  points: readonly YearlyAveragePricePoint[],
  index: number,
): number | null {
  if (index <= 0 || index >= points.length) {
    return null;
  }

  const previousPrice = points[index - 1].averagePrice;

  if (previousPrice === 0) {
    return null;
  }

  return ((points[index].averagePrice - previousPrice) / previousPrice) * 100;
}

export function formatPercentage(value: number): string {
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(1)}%`;
}

export type PerformanceEvidence = {
  readonly facts: readonly string[];
  readonly outsideQueryInference: string | null;
};

export function getPerformanceEvidence(
  performance: YearlyAveragePriceResult["performance"],
): PerformanceEvidence {
  const facts: string[] = [];

  if (performance.rowsRead !== null) {
    facts.push(`${formatCompactCount(performance.rowsRead)} rows read`);
  }

  if (performance.bytesRead !== null) {
    facts.push(`${formatBytes(performance.bytesRead)} scanned`);
  }

  if (performance.serverElapsedMs !== null) {
    facts.push(
      `${formatDuration(performance.serverElapsedMs)} ClickHouse execution`,
    );
  }

  facts.push(`${formatDuration(performance.roundTripMs)} end-to-end`);

  if (performance.serverElapsedMs === null) {
    return { facts, outsideQueryInference: null };
  }

  const outsideQueryMs = Math.max(
    0,
    performance.roundTripMs - performance.serverElapsedMs,
  );
  const isLikelyInfrastructureDelay =
    outsideQueryMs >= 5_000 &&
    performance.roundTripMs >= performance.serverElapsedMs * 5;

  return {
    facts,
    outsideQueryInference: isLikelyInfrastructureDelay
      ? `${formatDuration(outsideQueryMs)} occurred outside query execution; likely service wake-up or network latency.`
      : null,
  };
}
