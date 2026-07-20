"use client";

import {
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type { YearlyAveragePriceResult } from "@/lib/analysis/results";

import { AccessibleDataTable } from "./accessible-data-table";
import {
  formatCompactCount,
  formatCompactPrice,
  formatCount,
  formatPercentage,
  formatPrice,
  getYearOverYearChange,
} from "./formatters";
import { PerformanceProof } from "./performance-proof";

type YearlyPriceTraceProps = {
  readonly title: string;
  readonly explanation: string;
  readonly result: YearlyAveragePriceResult;
};

const PRICE_TICK_COUNT = 4;

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

export function YearlyPriceTrace({
  title,
  explanation,
  result,
}: YearlyPriceTraceProps) {
  const points = useMemo(
    () => [...result.points].sort((left, right) => left.year - right.year),
    [result.points],
  );
  const [selectedIndex, setSelectedIndex] = useState(
    Math.max(0, points.length - 1),
  );
  const { containerRef, width } = useContainerWidth();
  const titleId = useId();
  const descriptionId = useId();
  const selectedPoint = points[selectedIndex];

  if (selectedPoint === undefined) {
    return (
      <section aria-labelledby={titleId} className="space-y-2">
        <h2 className="text-xl font-medium" id={titleId}>
          {title}
        </h2>
        <p className="text-sm text-muted-foreground">
          This analysis returned no yearly values.
        </p>
      </section>
    );
  }

  const height = width < 480 ? 340 : 400;
  const margin = { top: 24, right: 18, bottom: 26, left: 62 };
  const priceBottom = height - 112;
  const volumeTop = height - 78;
  const volumeBottom = height - margin.bottom;
  const plotWidth = width - margin.left - margin.right;
  const pointStep = points.length === 1 ? 0 : plotWidth / (points.length - 1);
  const xForIndex = (index: number) => margin.left + index * pointStep;
  const prices = points.map((point) => point.averagePrice);
  const minimumPrice = Math.min(...prices);
  const maximumPrice = Math.max(...prices);
  const priceRange = Math.max(1, maximumPrice - minimumPrice);
  const paddedMinimumPrice = Math.max(0, minimumPrice - priceRange * 0.12);
  const paddedMaximumPrice = maximumPrice + priceRange * 0.12;
  const paddedPriceRange = paddedMaximumPrice - paddedMinimumPrice;
  const maximumTransactions = Math.max(
    1,
    ...points.map((point) => point.transactionCount),
  );
  const yForPrice = (price: number) =>
    margin.top +
    ((paddedMaximumPrice - price) / paddedPriceRange) *
      (priceBottom - margin.top);
  const linePath = points
    .map((point, index) => {
      const command = index === 0 ? "M" : "L";
      return `${command}${xForIndex(index).toFixed(2)},${yForPrice(point.averagePrice).toFixed(2)}`;
    })
    .join(" ");
  const priceTicks = Array.from({ length: PRICE_TICK_COUNT }, (_, index) => {
    const ratio = index / (PRICE_TICK_COUNT - 1);
    return paddedMaximumPrice - ratio * paddedPriceRange;
  });
  const yearTickIndexes = chooseTickIndexes(points.length, width);
  const barWidth = Math.max(
    4,
    Math.min(28, points.length === 1 ? plotWidth * 0.25 : pointStep * 0.46),
  );
  const change = getYearOverYearChange(points, selectedIndex);
  const selectedX = xForIndex(selectedIndex);
  const selectedY = yForPrice(selectedPoint.averagePrice);

  return (
    <article className="space-y-6">
      <header className="space-y-2">
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Average sale price
        </p>
        <h2 className="text-2xl font-medium tracking-tight" id={titleId}>
          {title}
        </h2>
        <p className="max-w-3xl text-sm text-muted-foreground" id={descriptionId}>
          {explanation}
        </p>
      </header>

      <figure aria-labelledby={titleId} aria-describedby={descriptionId}>
        <div ref={containerRef}>
          <svg
            aria-label={`${title}. Average sale price line with transaction volume by year.`}
            className="block w-full"
            height={height}
            role="img"
            viewBox={`0 0 ${width} ${height}`}
            width={width}
          >
            <title>{title}</title>
            <desc>
              Average property prices are shown as a line. Transaction counts
              are shown as aligned bars below it. Use the year control after the
              chart to inspect exact values with a keyboard.
            </desc>

            {priceTicks.map((tick) => {
              const y = yForPrice(tick);

              return (
                <g key={tick}>
                  <line
                    stroke="var(--border)"
                    strokeWidth="1"
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
                    {formatCompactPrice(tick)}
                  </text>
                </g>
              );
            })}

            <line
              stroke="var(--border)"
              strokeWidth="1"
              x1={margin.left}
              x2={width - margin.right}
              y1={priceBottom}
              y2={priceBottom}
            />

            <text
              fill="var(--muted-foreground)"
              fontSize="11"
              x={margin.left}
              y={volumeTop - 9}
            >
              Transactions
            </text>
            <text
              fill="var(--muted-foreground)"
              fontSize="11"
              textAnchor="end"
              x={width - margin.right}
              y={volumeTop - 9}
            >
              peak {formatCompactCount(maximumTransactions)}
            </text>

            {points.map((point, index) => {
              const barHeight =
                (point.transactionCount / maximumTransactions) *
                (volumeBottom - volumeTop);

              return (
                <rect
                  aria-hidden="true"
                  fill={
                    index === selectedIndex
                      ? "var(--foreground)"
                      : "var(--chart-1)"
                  }
                  height={barHeight}
                  key={point.year}
                  onPointerEnter={() => setSelectedIndex(index)}
                  rx="1"
                  width={barWidth}
                  x={xForIndex(index) - barWidth / 2}
                  y={volumeBottom - barHeight}
                />
              );
            })}

            <line
              aria-hidden="true"
              stroke="var(--muted-foreground)"
              strokeWidth="1"
              x1={selectedX}
              x2={selectedX}
              y1={margin.top}
              y2={volumeBottom}
            />

            <path
              d={linePath}
              fill="none"
              stroke="var(--chart-3)"
              strokeLinejoin="round"
              strokeWidth="2.5"
              vectorEffect="non-scaling-stroke"
            />

            {points.map((point, index) => (
              <circle
                aria-hidden="true"
                cx={xForIndex(index)}
                cy={yForPrice(point.averagePrice)}
                fill={
                  index === selectedIndex
                    ? "var(--background)"
                    : "var(--chart-3)"
                }
                key={point.year}
                onPointerEnter={() => setSelectedIndex(index)}
                r={index === selectedIndex ? 5 : 3}
                stroke="var(--chart-3)"
                strokeWidth={index === selectedIndex ? 3 : 1}
              />
            ))}

            <circle
              aria-hidden="true"
              cx={selectedX}
              cy={selectedY}
              fill="var(--chart-3)"
              r="2"
            />

            {yearTickIndexes.map((index) => (
              <text
                fill="var(--muted-foreground)"
                fontSize="11"
                key={points[index].year}
                textAnchor="middle"
                x={xForIndex(index)}
                y={height - 5}
              >
                {points[index].year}
              </text>
            ))}
          </svg>
        </div>

        <div className="mt-2">
          <label className="sr-only" htmlFor={`${titleId}-year`}>
            Selected year
          </label>
          <input
            aria-valuetext={`${selectedPoint.year}: ${formatPrice(selectedPoint.averagePrice)} average price, ${formatCount(selectedPoint.transactionCount)} transactions`}
            className="w-full accent-foreground"
            id={`${titleId}-year`}
            max={points.length - 1}
            min="0"
            onChange={(event) => setSelectedIndex(Number(event.target.value))}
            step="1"
            type="range"
            value={selectedIndex}
          />
        </div>

        <output
          aria-live="polite"
          className="mt-3 block border-y py-3 text-sm tabular-nums"
          htmlFor={`${titleId}-year`}
        >
          <span className="font-medium">{selectedPoint.year}</span>
          <span aria-hidden="true"> · </span>
          {formatPrice(selectedPoint.averagePrice)} average
          <span aria-hidden="true"> · </span>
          {formatCount(selectedPoint.transactionCount)} sales
          <span aria-hidden="true"> · </span>
          {change === null
            ? "first year in range"
            : `${formatPercentage(change)} vs ${points[selectedIndex - 1].year}`}
        </output>
      </figure>

      <PerformanceProof
        performance={result.performance}
        queryId={result.queryId}
      />
      <AccessibleDataTable points={points} />
    </article>
  );
}
