"use client";

import {
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type { TimeSeriesRequest } from "@/lib/time-series/contracts";
import type { TimeSeriesLoadResult } from "@/lib/time-series/load";
import { supportsQueryArena } from "@/lib/query-arena/signature";

import {
  formatBytes,
  formatCompactCount,
  formatCompactPrice,
  formatComputeDuration,
  formatCount,
  formatDuration,
  formatPrice,
} from "./formatters";
import { QueryArenaCard } from "./query-arena-card";

type TimeSeriesTraceProps = {
  readonly title: string;
  readonly explanation: string;
  readonly request: TimeSeriesRequest;
  readonly loaded: TimeSeriesLoadResult;
};

const DAY_IN_MILLISECONDS = 86_400_000;
const Y_TICK_COUNT = 4;
const SERIES_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
] as const;

function useContainerWidth() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(720);

  useLayoutEffect(() => {
    const container = containerRef.current;

    if (container === null) {
      return;
    }

    const updateWidth = () => {
      setWidth(Math.max(280, Math.round(container.getBoundingClientRect().width)));
    };

    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    observer.observe(container);

    return () => observer.disconnect();
  }, []);

  return { containerRef, width };
}

function uniquePeriods(periodStarts: Int32Array): number[] {
  const periods: number[] = [];

  for (const period of periodStarts) {
    if (periods.at(-1) !== period) {
      periods.push(period);
    }
  }

  return periods;
}

function chooseTickIndexes(pointCount: number, width: number): number[] {
  if (pointCount <= 1) {
    return pointCount === 0 ? [] : [0];
  }

  const maximumTickCount = width < 480 ? 3 : 5;
  const step = Math.ceil((pointCount - 1) / (maximumTickCount - 1));
  const indexes = Array.from(
    { length: Math.ceil(pointCount / step) },
    (_, index) => index * step,
  ).filter((index) => index < pointCount);

  if (indexes.at(-1) !== pointCount - 1) {
    indexes.push(pointCount - 1);
  }

  return indexes;
}

function formatPeriod(period: number, interval: TimeSeriesRequest["interval"]) {
  const date = new Date(period * DAY_IN_MILLISECONDS);

  if (interval === "year") {
    return String(date.getUTCFullYear());
  }

  if (interval === "quarter") {
    return `${date.getUTCFullYear()} Q${Math.floor(date.getUTCMonth() / 3) + 1}`;
  }

  return new Intl.DateTimeFormat("en-GB", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

function formatMetric(
  value: number,
  metric: TimeSeriesRequest["metric"],
  compact = false,
  percent = false,
) {
  if (percent) {
    return `${value.toFixed(compact ? 0 : 1)}%`;
  }

  if (metric === "average_price" || metric === "median_price") {
    return compact ? formatCompactPrice(value) : formatPrice(value);
  }

  return compact ? formatCompactCount(value) : formatCount(Math.round(value));
}

export function TimeSeriesTrace({
  title,
  explanation,
  request,
  loaded,
}: TimeSeriesTraceProps) {
  const { columns } = loaded;
  const derived = loaded.derived;
  const { performance } = loaded;
  const periods = useMemo(
    () => uniquePeriods(columns.periodStarts),
    [columns.periodStarts],
  );
  const periodIndexes = useMemo(
    () => new Map(periods.map((period, index) => [period, index])),
    [periods],
  );
  const rowsBySeries = useMemo(() => {
    const rows = Array.from({ length: columns.seriesCount }, () => [] as number[]);

    for (let row = 0; row < columns.rowCount; row += 1) {
      if (
        derived !== null &&
        derived.kind !== "anomaly_score" &&
        derived.validity[row] !== 1
      ) {
        continue;
      }

      const seriesIndex = columns.seriesIndexes[row];

      if (seriesIndex !== undefined) {
        rows[seriesIndex]?.push(row);
      }
    }

    return rows;
  }, [columns, derived]);
  const [selectedPeriodIndex, setSelectedPeriodIndex] = useState(
    Math.max(0, periods.length - 1),
  );
  const { containerRef, width } = useContainerWidth();
  const titleId = useId();
  const descriptionId = useId();
  const displayValues =
    derived !== null && derived.kind !== "anomaly_score"
      ? derived.values
      : columns.values;
  const displaysPercent =
    derived?.kind === "period_change_percent" || derived?.kind === "share";
  const visibleRows = Array.from(
    { length: columns.rowCount },
    (_, row) => row,
  ).filter(
    (row) =>
      derived === null ||
      derived.kind === "anomaly_score" ||
      derived.validity[row] === 1,
  );

  if (periods.length === 0 || displayValues.length === 0) {
    return (
      <section aria-labelledby={titleId} className="space-y-2 border-y py-6">
        <h2 className="text-xl font-medium" id={titleId}>
          {title}
        </h2>
        <p className="text-sm text-muted-foreground">
          No transactions matched this analysis.
        </p>
      </section>
    );
  }

  const height = width < 480 ? 330 : 390;
  const margin = { top: 28, right: 18, bottom: 38, left: 64 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const xForPeriod = (period: number) => {
    const index = periodIndexes.get(period) ?? 0;
    return periods.length === 1
      ? margin.left + plotWidth / 2
      : margin.left + (index / (periods.length - 1)) * plotWidth;
  };
  let minimumValue = Number.POSITIVE_INFINITY;
  let maximumValue = Number.NEGATIVE_INFINITY;

  for (let row = 0; row < displayValues.length; row += 1) {
    if (
      derived !== null &&
      derived.kind !== "anomaly_score" &&
      derived.validity[row] !== 1
    ) {
      continue;
    }

    const value = displayValues[row];
    minimumValue = Math.min(minimumValue, value);
    maximumValue = Math.max(maximumValue, value);
  }

  if (!Number.isFinite(minimumValue) || !Number.isFinite(maximumValue)) {
    return (
      <section aria-labelledby={titleId} className="space-y-2 border-y py-6">
        <h2 className="text-xl font-medium" id={titleId}>{title}</h2>
        <p className="text-sm text-muted-foreground">
          This calculation needs at least two adjacent periods.
        </p>
      </section>
    );
  }

  const signedDomain = derived?.kind === "period_change_percent";
  const domainMinimum = signedDomain ? Math.min(0, minimumValue) : minimumValue;
  const domainMaximum = signedDomain ? Math.max(0, maximumValue) : maximumValue;
  const valueRange = Math.max(1, domainMaximum - domainMinimum);
  const paddedMinimum = signedDomain
    ? domainMinimum - valueRange * 0.1
    : Math.max(0, domainMinimum - valueRange * 0.1);
  const paddedMaximum = domainMaximum + valueRange * 0.1;
  const paddedRange = paddedMaximum - paddedMinimum;
  const yForValue = (value: number) =>
    margin.top + ((paddedMaximum - value) / paddedRange) * plotHeight;
  const yTicks = Array.from({ length: Y_TICK_COUNT }, (_, index) => {
    const ratio = index / (Y_TICK_COUNT - 1);
    return paddedMaximum - ratio * paddedRange;
  });
  const timeTickIndexes = chooseTickIndexes(periods.length, width);
  const selectedPeriod = periods[selectedPeriodIndex] ?? periods.at(-1) ?? 0;
  const selectedRows: number[] = [];

  for (let row = 0; row < columns.rowCount; row += 1) {
    if (
      columns.periodStarts[row] === selectedPeriod &&
      !(
        derived !== null &&
        derived.kind !== "anomaly_score" &&
        derived.validity[row] !== 1
      )
    ) {
      selectedRows.push(row);
    }
  }

  const comparison = (() => {
    if (selectedRows.length !== 2) {
      return null;
    }

    const leftRow = selectedRows[0];
    const rightRow = selectedRows[1];
    const leftValue = displayValues[leftRow];
    const rightValue = displayValues[rightRow];

    if (leftValue === rightValue) {
      return {
        equal: true as const,
        leftName: columns.seriesNames[columns.seriesIndexes[leftRow]],
        rightName: columns.seriesNames[columns.seriesIndexes[rightRow]],
      };
    }

    const higherRow = leftValue > rightValue ? leftRow : rightRow;
    const lowerRow = higherRow === leftRow ? rightRow : leftRow;
    const difference = displayValues[higherRow] - displayValues[lowerRow];
    const percentage =
      displayValues[lowerRow] === 0
        ? null
        : (difference / displayValues[lowerRow]) * 100;

    return {
      equal: false as const,
      higherName: columns.seriesNames[columns.seriesIndexes[higherRow]],
      lowerName: columns.seriesNames[columns.seriesIndexes[lowerRow]],
      difference,
      percentage,
    };
  })();

  return (
    <article className="space-y-6">
      <header className="space-y-2">
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {derived?.kind === "period_change_percent"
            ? "Period change"
            : derived?.kind === "share"
              ? "Share of transactions"
              : request.metric === "average_price"
                ? "Average sale price"
                : request.metric === "median_price"
                  ? "Estimated median sale price"
                  : "Transaction volume"}
        </p>
        <h2 className="text-2xl font-medium tracking-tight" id={titleId}>
          {title}
        </h2>
        <p className="max-w-3xl text-sm text-muted-foreground" id={descriptionId}>
          {explanation}
        </p>
      </header>

      <figure aria-labelledby={titleId} aria-describedby={descriptionId}>
        <div className="mb-4 flex flex-wrap gap-x-5 gap-y-2 text-xs text-muted-foreground">
          {columns.seriesNames.map((series, index) => (
            <span className="inline-flex items-center gap-2" key={series}>
              <span
                aria-hidden="true"
                className="size-2 rounded-full"
                style={{
                  backgroundColor: SERIES_COLORS[index % SERIES_COLORS.length],
                }}
              />
              {series}
            </span>
          ))}
        </div>

        <div ref={containerRef}>
          <svg
            aria-label={`${title}. Interactive time-series chart.`}
            className="block w-full"
            height={height}
            role="img"
            viewBox={`0 0 ${width} ${height}`}
            width={width}
          >
            <title>{title}</title>
            <desc>
              Use the time control after the chart to inspect exact values for
              every series.
            </desc>

            {yTicks.map((tick) => {
              const y = yForValue(tick);

              return (
                <g key={tick}>
                  <line
                    stroke="var(--border)"
                    x1={margin.left}
                    x2={width - margin.right}
                    y1={y}
                    y2={y}
                  />
                  <text
                    fill="var(--muted-foreground)"
                    fontSize="11"
                    textAnchor="end"
                    x={margin.left - 10}
                    y={y + 4}
                  >
                    {formatMetric(tick, request.metric, true, displaysPercent)}
                  </text>
                </g>
              );
            })}

            <line
              stroke="var(--muted-foreground)"
              strokeDasharray="3 4"
              x1={xForPeriod(selectedPeriod)}
              x2={xForPeriod(selectedPeriod)}
              y1={margin.top}
              y2={height - margin.bottom}
            />

            {rowsBySeries.map((rows, seriesIndex) => {
              const path = rows
                .map((row, index) => {
                  const command = index === 0 ? "M" : "L";
                  return `${command}${xForPeriod(columns.periodStarts[row]).toFixed(2)},${yForValue(displayValues[row]).toFixed(2)}`;
                })
                .join(" ");

              return (
                <g key={columns.seriesNames[seriesIndex]}>
                  <path
                    d={path}
                    fill="none"
                    stroke={SERIES_COLORS[seriesIndex % SERIES_COLORS.length]}
                    strokeLinejoin="round"
                    strokeWidth="2.5"
                    vectorEffect="non-scaling-stroke"
                  />
                  {rows.map((row) => (
                    <circle
                      cx={xForPeriod(columns.periodStarts[row])}
                      cy={yForValue(displayValues[row])}
                      fill={SERIES_COLORS[seriesIndex % SERIES_COLORS.length]}
                      key={columns.periodStarts[row]}
                      onPointerEnter={() =>
                        setSelectedPeriodIndex(
                          periodIndexes.get(columns.periodStarts[row]) ?? 0,
                        )
                      }
                      r={columns.periodStarts[row] === selectedPeriod ? 4 : 2}
                      stroke={
                        derived?.kind === "anomaly_score" &&
                        derived.flags[row] === 1
                          ? "var(--destructive)"
                          : "none"
                      }
                      strokeWidth={
                        derived?.kind === "anomaly_score" &&
                        derived.flags[row] === 1
                          ? 4
                          : 0
                      }
                    />
                  ))}
                </g>
              );
            })}

            {timeTickIndexes.map((index) => (
              <text
                fill="var(--muted-foreground)"
                fontSize="11"
                key={periods[index]}
                textAnchor="middle"
                x={xForPeriod(periods[index])}
                y={height - 9}
              >
                {formatPeriod(periods[index], request.interval)}
              </text>
            ))}
          </svg>
        </div>

        <label className="sr-only" htmlFor={`${titleId}-period`}>
          Selected time period
        </label>
        <input
          className="w-full accent-foreground"
          id={`${titleId}-period`}
          max={periods.length - 1}
          min="0"
          onChange={(event) => setSelectedPeriodIndex(Number(event.target.value))}
          step="1"
          type="range"
          value={selectedPeriodIndex}
        />

        <output
          aria-live="polite"
          className="mt-3 block border-y py-3 text-sm tabular-nums"
          htmlFor={`${titleId}-period`}
        >
          <span className="font-medium">
            {formatPeriod(selectedPeriod, request.interval)}
          </span>
          {selectedRows.map((row) => (
            <span key={columns.seriesIndexes[row]}>
              <span aria-hidden="true"> · </span>
              {columns.seriesNames[columns.seriesIndexes[row]]}: {" "}
              {formatMetric(
                displayValues[row],
                request.metric,
                false,
                displaysPercent,
              )}
              {request.metric !== "transaction_count" && !displaysPercent && (
                <span className="text-muted-foreground">
                  {" "}
                  ({formatCount(Number(columns.observationCounts[row]))} sales)
                </span>
              )}
            </span>
          ))}
          {comparison !== null && (
            <span className="mt-2 block font-medium">
              {comparison.equal
                ? `${comparison.leftName} and ${comparison.rightName} are equal.`
                : `${comparison.higherName} is ${formatMetric(comparison.difference, request.metric, false, displaysPercent)}${
                    comparison.percentage === null
                      ? ""
                      : ` (${comparison.percentage.toFixed(1)}%)`
                  } higher than ${comparison.lowerName}.`}
            </span>
          )}
        </output>
      </figure>

      <section aria-label="Performance evidence" className="space-y-3">
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Binary pipeline
        </p>
        <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border bg-border sm:grid-cols-3 lg:grid-cols-6">
          <div className="bg-background p-3">
            <dt className="text-xs text-muted-foreground">Arrow payload</dt>
            <dd className="mt-1 font-mono text-sm">
              {formatBytes(loaded.arrowBytes)}
            </dd>
          </div>
          <div className="bg-background p-3">
            <dt className="text-xs text-muted-foreground">Typed rows</dt>
            <dd className="mt-1 font-mono text-sm">
              {formatCount(columns.rowCount)}
            </dd>
          </div>
          <div className="bg-background p-3">
            <dt className="text-xs text-muted-foreground">Round trip</dt>
            <dd className="mt-1 font-mono text-sm">
              {formatDuration(performance.roundTripMs)}
            </dd>
          </div>
          <div className="bg-background p-3">
            <dt className="text-xs text-muted-foreground">WASM startup</dt>
            <dd className="mt-1 font-mono text-sm">
              {performance.wasmWasReady
                ? "preloaded"
                : formatComputeDuration(performance.wasmStartupWaitMs)}
            </dd>
          </div>
          <div className="bg-background p-3">
            <dt className="text-xs text-muted-foreground">Rust decode</dt>
            <dd className="mt-1 font-mono text-sm">
              {formatComputeDuration(performance.rustDecodeMs)}
            </dd>
          </div>
          <div className="bg-background p-3">
            <dt className="text-xs text-muted-foreground">Rust analysis</dt>
            <dd className="mt-1 font-mono text-sm">
              {loaded.derived === null
                ? "not needed"
                : formatComputeDuration(performance.rustTransformMs)}
            </dd>
          </div>
        </dl>
        {loaded.queryId !== null && (
          <p className="truncate font-mono text-xs text-muted-foreground">
            ClickHouse query {loaded.queryId}
          </p>
        )}
      </section>

      {supportsQueryArena(request) && (
        <QueryArenaCard
          currentStrategy={loaded.strategy}
          request={request}
        />
      )}

      <details className="border-t pt-4">
        <summary className="cursor-pointer text-sm font-medium">
          View accessible data table
        </summary>
        <div className="mt-3 max-h-80 overflow-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b">
                <th className="py-2 pr-4">Period</th>
                <th className="py-2 pr-4">Series</th>
                <th className="py-2 text-right">Value</th>
                {derived?.kind === "anomaly_score" && (
                  <>
                    <th className="py-2 text-right">Expected</th>
                    <th className="py-2 text-right">Robust score</th>
                    <th className="py-2 text-right">Finding</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((row) => (
                <tr className="border-b" key={`${columns.periodStarts[row]}-${columns.seriesIndexes[row]}`}>
                  <td className="py-2 pr-4">
                    {formatPeriod(columns.periodStarts[row], request.interval)}
                  </td>
                  <td className="py-2 pr-4">
                    {columns.seriesNames[columns.seriesIndexes[row]]}
                  </td>
                  <td className="py-2 text-right tabular-nums">
                    {formatMetric(
                      displayValues[row],
                      request.metric,
                      false,
                      displaysPercent,
                    )}
                  </td>
                  {derived?.kind === "anomaly_score" && (
                    <>
                      <td className="py-2 text-right tabular-nums">
                        {derived.validity[row] === 1
                          ? formatMetric(
                              derived.expected[row],
                              request.metric,
                            )
                          : "—"}
                      </td>
                      <td className="py-2 text-right tabular-nums">
                        {derived.validity[row] === 1
                          ? derived.scores[row].toFixed(2)
                          : "—"}
                      </td>
                      <td className="py-2 text-right">
                        {derived.validity[row] !== 1
                          ? "Insufficient history"
                          : derived.flags[row] === 1
                            ? "Unusual"
                            : "Expected"}
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </article>
  );
}
