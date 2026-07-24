"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Zap } from "lucide-react";

import { DashboardAssembly } from "@/components/dashboard-assembly";
import { AnalysisEvidenceLink } from "@/components/analysis/analysis-evidence-link";
import {
  DeepDiveActions,
  type AnalysisDeepDiveAction,
} from "@/components/analysis/analysis-exploration";
import { LivingDashboard } from "@/components/analysis/living-dashboard";
import { useAnalysisPerformance } from "@/components/analysis/performance-context";
import {
  formatSemanticValue,
  type SemanticCategoryItem,
  type SemanticSeriesPoint,
  type SemanticVisualModel,
} from "@/lib/analysis/semantic-result";
import {
  loadSemanticAnalysis,
  type SemanticLoadResult,
} from "@/lib/analysis/semantic-load";
import type { SemanticAnalysisToolOutput } from "@/lib/analysis/semantic-tool-output";
import { queryArenaSemanticRequestSchema } from "@/lib/query-arena/contracts";
import type { QueryArenaRequest } from "@/lib/query-arena/contracts";

import { QueryArenaReporter } from "./query-arena-reporter";

type SemanticAnalysisResultProps = {
  readonly output: SemanticAnalysisToolOutput;
};

type SemanticSelection =
  | {
      readonly kind: "category";
      readonly index: number;
    }
  | {
      readonly kind: "period";
      readonly periodStart: number;
      readonly seriesIndex: number | null;
    }
  | {
      readonly kind: "bin";
      readonly index: number;
    };

const SERIES_COLOURS = ["#697cc7", "#21c5be", "#ef9ca5", "#e3a53b", "#885cf6"];

function formatPeriod(
  day: number,
  interval: "year" | "quarter" | "month",
): string {
  const date = new Date(day * 86_400_000);

  if (interval === "year") {
    return String(date.getUTCFullYear());
  }

  if (interval === "quarter") {
    return `Q${Math.floor(date.getUTCMonth() / 3) + 1} ${date.getUTCFullYear()}`;
  }

  return new Intl.DateTimeFormat("en-GB", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

function semanticRowCount(model: SemanticVisualModel): number {
  switch (model.kind) {
    case "trend":
    case "anomaly":
      return model.points.length;
    case "comparison":
    case "composition":
      return model.layout === "categorical"
        ? model.items.length
        : model.points.length;
    case "ranking":
      return model.items.length;
    case "distribution":
      return model.bins.length;
  }
}

function CategoryChart({
  items,
  model,
  onSelect,
  selectedIndex,
}: {
  readonly items: readonly SemanticCategoryItem[];
  readonly model: SemanticVisualModel;
  readonly onSelect: (selection: SemanticSelection) => void;
  readonly selectedIndex: number | null;
}) {
  const visible = items.slice(0, 8);
  const maximum = Math.max(...visible.map((item) => Math.abs(item.value)), 1);

  return (
    <div className="semantic-category-field">
      {visible.map((item, index) => {
        const ratio = Math.abs(item.value) / maximum;

        return (
          <button
            aria-pressed={selectedIndex === index}
            className="semantic-category-item group"
            key={item.label}
            onClick={() => onSelect({ kind: "category", index })}
            style={{
              opacity:
                selectedIndex === null || selectedIndex === index ? 1 : 0.34,
            }}
            type="button"
          >
            <span className="semantic-category-label">{item.label}</span>
            <span aria-hidden="true" className="semantic-category-track">
              <span
                className="semantic-category-fill"
                style={{
                  background: SERIES_COLOURS[index % SERIES_COLOURS.length],
                  opacity: 1 - index * 0.06,
                  width: `${ratio * 100}%`,
                }}
              />
              <span
                className="semantic-category-orb"
                style={{
                  background: SERIES_COLOURS[index % SERIES_COLOURS.length],
                  left: `${ratio * 100}%`,
                }}
              />
            </span>
            <span className="semantic-category-value">
              {formatSemanticValue(item.value, model.valueFormat)}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function SeriesChart({
  highlighted = new Set<string>(),
  interval,
  model,
  onSelect,
  points,
  selectedPeriod,
}: {
  readonly highlighted?: ReadonlySet<string>;
  readonly interval: "year" | "quarter" | "month";
  readonly model: SemanticVisualModel;
  readonly onSelect: (selection: SemanticSelection) => void;
  readonly points: readonly SemanticSeriesPoint[];
  readonly selectedPeriod: number | null;
}) {
  const valid = points.filter((point) => point.valid);
  const periods = [...new Set(valid.map((point) => point.periodStart))].sort(
    (left, right) => left - right,
  );
  const minimum = Math.min(...valid.map((point) => point.value), 0);
  const maximum = Math.max(...valid.map((point) => point.value), 1);
  const range = maximum - minimum || 1;
  const width = 760;
  const height = 270;
  const padding = 18;
  const x = (period: number) =>
    periods.length === 1
      ? width / 2
      : padding +
        (periods.indexOf(period) / (periods.length - 1)) *
          (width - padding * 2);
  const y = (value: number) =>
    height - padding - ((value - minimum) / range) * (height - padding * 2);
  const series = [...new Set(valid.map((point) => point.seriesIndex))];
  const seriesNames =
    "seriesNames" in model ? model.seriesNames : ([] as readonly string[]);
  const areaGradientId = useId();
  const selectedPeriodIndex =
    selectedPeriod === null
      ? Math.max(0, periods.length - 1)
      : Math.max(0, periods.indexOf(selectedPeriod));

  return (
    <div>
      {series.length > 1 && (
        <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2">
          {series.slice(0, 5).map((seriesIndex, index) => (
            <span
              className="flex items-center gap-1.5 text-[10px] text-[var(--ink-secondary)]"
              key={seriesIndex}
            >
              <span
                className="size-2 rounded-full"
                style={{
                  background: SERIES_COLOURS[index % SERIES_COLOURS.length],
                }}
              />
              {seriesNames[seriesIndex] ?? `Series ${seriesIndex + 1}`}
            </span>
          ))}
          {series.length > 5 && (
            <span className="text-[10px] text-[var(--ink-tertiary)]">
              +{series.length - 5} more
            </span>
          )}
        </div>
      )}
      <svg
        aria-label={`${model.title}. Interactive time-series chart.`}
        className="h-[14rem] w-full overflow-visible"
        role="img"
        viewBox={`0 0 ${width} ${height}`}
      >
        <defs>
          <linearGradient id={areaGradientId} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#8796d6" stopOpacity="0.24" />
            <stop offset="100%" stopColor="#8796d6" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75].map((ratio) => (
          <line
            key={ratio}
            stroke="rgba(24,34,55,.08)"
            strokeDasharray="3 5"
            x1="0"
            x2={width}
            y1={height * ratio}
            y2={height * ratio}
          />
        ))}
        {selectedPeriod !== null && (
          <line
            className="living-selection-line"
            stroke="#697cc7"
            strokeDasharray="4 5"
            x1={x(selectedPeriod)}
            x2={x(selectedPeriod)}
            y1={padding}
            y2={height - padding}
          />
        )}
        {series.map((seriesIndex, index) => {
          const rows = valid
            .filter((point) => point.seriesIndex === seriesIndex)
            .sort((left, right) => left.periodStart - right.periodStart);
          const path = rows
            .map(
              (point, pointIndex) =>
                `${pointIndex === 0 ? "M" : "L"} ${x(point.periodStart)} ${y(point.value)}`,
            )
            .join(" ");
          const area =
            index === 0 && rows.length > 1
              ? `${path} L ${x(rows.at(-1)!.periodStart)} ${height - padding} L ${x(rows[0]!.periodStart)} ${height - padding} Z`
              : null;

          return (
            <g key={seriesIndex}>
              {area !== null && (
                <path d={area} fill={`url(#${areaGradientId})`} />
              )}
              <path
                className="living-trace-line"
                d={path}
                fill="none"
                pathLength="1"
                stroke={SERIES_COLOURS[index % SERIES_COLOURS.length]}
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="3"
              />
              {rows.map((point) => {
                const isHighlighted = highlighted.has(
                  `${point.periodStart}:${point.seriesIndex}`,
                );

                return rows.length <= 24 || isHighlighted ? (
                  <circle
                    className="cursor-pointer transition-[r,opacity] duration-150 motion-reduce:transition-none"
                    cx={x(point.periodStart)}
                    cy={y(point.value)}
                    fill={isHighlighted ? "#ef9ca5" : "white"}
                    key={point.periodStart}
                    onClick={() =>
                      onSelect({
                        kind: "period",
                        periodStart: point.periodStart,
                        seriesIndex: point.seriesIndex,
                      })
                    }
                    onPointerEnter={() =>
                      onSelect({
                        kind: "period",
                        periodStart: point.periodStart,
                        seriesIndex: point.seriesIndex,
                      })
                    }
                    r={isHighlighted ? "5.5" : "3.5"}
                    stroke={
                      isHighlighted
                        ? "white"
                        : SERIES_COLOURS[index % SERIES_COLOURS.length]
                    }
                    strokeWidth="2"
                  >
                    <title>
                      {formatPeriod(point.periodStart, interval)}:{" "}
                      {formatSemanticValue(point.value, model.valueFormat)}
                    </title>
                  </circle>
                ) : null;
              })}
            </g>
          );
        })}
      </svg>
      <div className="mt-1 grid grid-cols-[auto_minmax(6rem,1fr)_auto] items-center gap-3 text-[10px] text-[var(--ink-tertiary)]">
        <span>{periods[0] === undefined ? "" : formatPeriod(periods[0], interval)}</span>
        <input
          aria-label="Inspect a period"
          className="w-full accent-[#697cc7]"
          disabled={periods.length === 0}
          max={Math.max(0, periods.length - 1)}
          min="0"
          onChange={(event) => {
            const period = periods[Number(event.target.value)];

            if (period !== undefined) {
              onSelect({
                kind: "period",
                periodStart: period,
                seriesIndex: null,
              });
            }
          }}
          type="range"
          value={selectedPeriodIndex}
        />
        <span>
          {periods.at(-1) === undefined
            ? ""
            : formatPeriod(periods.at(-1)!, interval)}
        </span>
      </div>
    </div>
  );
}

function DistributionChart({
  model,
  onSelect,
  selectedIndex,
}: {
  readonly model: Extract<SemanticVisualModel, { kind: "distribution" }>;
  readonly onSelect: (selection: SemanticSelection) => void;
  readonly selectedIndex: number | null;
}) {
  const maximum = Math.max(...model.bins.map((bin) => Math.abs(bin.value)), 1);
  const gradientId = useId();
  const width = 760;
  const height = 260;
  const padding = 12;
  const step =
    model.bins.length <= 1
      ? 0
      : (width - padding * 2) / (model.bins.length - 1);
  const points = model.bins.map((bin, index) => ({
    x: model.bins.length <= 1 ? width / 2 : padding + index * step,
    y:
      height -
      padding -
      (Math.abs(bin.value) / maximum) * (height - padding * 2),
  }));
  const linePath = points.reduce((path, point, index) => {
    if (index === 0) {
      return `M ${point.x} ${point.y}`;
    }

    return `${path} L ${point.x} ${point.y}`;
  }, "");
  const areaPath =
    points.length === 0
      ? ""
      : `${linePath} L ${points.at(-1)!.x} ${height - padding} L ${points[0]!.x} ${height - padding} Z`;
  const selected = selectedIndex === null ? null : points[selectedIndex];

  return (
    <div className="semantic-density-field">
      <svg
        aria-label={`${model.title}. Select a range to inspect its density.`}
        className="h-[14rem] w-full overflow-visible"
        role="img"
        viewBox={`0 0 ${width} ${height}`}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#697cc7" stopOpacity="0.42" />
            <stop offset="58%" stopColor="#8796d6" stopOpacity="0.16" />
            <stop offset="100%" stopColor="#21c5be" stopOpacity="0.03" />
          </linearGradient>
          <filter id={`${gradientId}-glow`} x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur result="blur" stdDeviation="5" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        <path d={areaPath} fill={`url(#${gradientId})`} />
        <path
          className="living-trace-line"
          d={linePath}
          fill="none"
          pathLength="1"
          stroke="#697cc7"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="3.5"
        />
        {selected !== null && (
          <g className="living-density-focus">
            <line
              stroke="#21c5be"
              strokeDasharray="4 5"
              x1={selected.x}
              x2={selected.x}
              y1={padding}
              y2={height - padding}
            />
            <circle
              cx={selected.x}
              cy={selected.y}
              fill="#21c5be"
              filter={`url(#${gradientId}-glow)`}
              r="6"
              stroke="white"
              strokeWidth="3"
            />
          </g>
        )}
        {model.bins.map((bin, index) => {
          const start = index === 0 ? 0 : points[index - 1]!.x + step / 2;
          const end =
            index === model.bins.length - 1
              ? width
              : points[index]!.x + step / 2;

          return (
            <rect
              fill="transparent"
              height={height}
              key={`${bin.start}-${bin.end}-${bin.seriesIndex}-${index}`}
              onClick={() => onSelect({ kind: "bin", index })}
              onPointerEnter={() => onSelect({ kind: "bin", index })}
              width={Math.max(1, end - start)}
              x={start}
              y="0"
            >
              <title>
                {formatSemanticValue(bin.start, model.measureFormat)}–{" "}
                {formatSemanticValue(bin.end, model.measureFormat)}:{" "}
                {formatSemanticValue(bin.value, model.valueFormat)}
              </title>
            </rect>
          );
        })}
      </svg>
      <div className="mt-2 grid grid-cols-[auto_minmax(6rem,1fr)_auto] items-center gap-3 text-[10px] text-[var(--ink-tertiary)]">
        <span>
          {model.bins[0] === undefined
            ? ""
            : formatSemanticValue(model.bins[0].start, model.measureFormat)}
        </span>
        <input
          aria-label="Inspect a distribution range"
          className="w-full accent-[#697cc7]"
          disabled={model.bins.length === 0}
          max={Math.max(0, model.bins.length - 1)}
          min="0"
          onChange={(event) =>
            onSelect({ kind: "bin", index: Number(event.target.value) })
          }
          type="range"
          value={selectedIndex ?? 0}
        />
        <span>
          {model.bins.at(-1) === undefined
            ? ""
            : formatSemanticValue(model.bins.at(-1)!.end, model.measureFormat)}
        </span>
      </div>
    </div>
  );
}

function AnomalyChart({
  model,
  onSelect,
  selectedPeriod,
}: {
  readonly model: Extract<SemanticVisualModel, { kind: "anomaly" }>;
  readonly onSelect: (selection: SemanticSelection) => void;
  readonly selectedPeriod: number | null;
}) {
  const points: SemanticSeriesPoint[] = model.points.map((point) => ({
    periodStart: point.periodStart,
    seriesIndex: point.seriesIndex,
    value: point.value,
    rawValue: point.value,
    observationCount: point.observationCount,
    valid: point.valid,
  }));
  const highlighted = new Set(
    model.points
      .filter((point) => point.flagged)
      .map((point) => `${point.periodStart}:${point.seriesIndex}`),
  );

  return (
    <div className="relative">
      <SeriesChart
        highlighted={highlighted}
        interval={model.interval}
        model={model}
        onSelect={onSelect}
        points={points}
        selectedPeriod={selectedPeriod}
      />
      <div className="absolute right-0 top-0 flex items-center gap-2 rounded-full bg-[#ef9ca5]/14 px-3 py-1.5 text-[10px] font-semibold text-[#9b4c58]">
        <span className="size-1.5 rounded-full bg-[#ef9ca5]" />
        {model.points.filter((point) => point.flagged).length} findings
      </div>
    </div>
  );
}

function MainVisual({
  model,
  onSelect,
  selection,
}: {
  readonly model: SemanticVisualModel;
  readonly onSelect: (selection: SemanticSelection) => void;
  readonly selection: SemanticSelection | null;
}) {
  switch (model.kind) {
    case "trend":
      return (
        <SeriesChart
          interval={model.interval}
          model={model}
          onSelect={onSelect}
          points={model.points}
          selectedPeriod={selection?.kind === "period" ? selection.periodStart : null}
        />
      );
    case "comparison":
    case "composition":
      return model.layout === "categorical" ? (
        <CategoryChart
          items={model.items}
          model={model}
          onSelect={onSelect}
          selectedIndex={selection?.kind === "category" ? selection.index : null}
        />
      ) : (
        <SeriesChart
          interval={model.interval!}
          model={model}
          onSelect={onSelect}
          points={model.points}
          selectedPeriod={selection?.kind === "period" ? selection.periodStart : null}
        />
      );
    case "ranking":
      return (
        <CategoryChart
          items={model.items}
          model={model}
          onSelect={onSelect}
          selectedIndex={selection?.kind === "category" ? selection.index : null}
        />
      );
    case "distribution":
      return (
        <DistributionChart
          model={model}
          onSelect={onSelect}
          selectedIndex={selection?.kind === "bin" ? selection.index : null}
        />
      );
    case "anomaly":
      return (
        <AnomalyChart
          model={model}
          onSelect={onSelect}
          selectedPeriod={selection?.kind === "period" ? selection.periodStart : null}
        />
      );
  }
}

function primaryValue(model: SemanticVisualModel): {
  readonly label: string;
  readonly value: string;
  readonly detail: string;
} {
  if (
    model.kind === "comparison" ||
    model.kind === "composition" ||
    model.kind === "ranking"
  ) {
    if ("items" in model && model.items.length > 0) {
      const strongest =
        model.kind === "ranking"
          ? model.items[0]!
          : [...model.items].sort(
              (left, right) => Math.abs(right.value) - Math.abs(left.value),
            )[0]!;
      return {
        label: strongest.label,
        value: formatSemanticValue(strongest.value, model.valueFormat),
        detail: model.categoryLabel ?? "Leading category",
      };
    }

    if (model.kind === "ranking") {
      return {
        label: "No categories",
        value: "—",
        detail: model.categoryLabel ?? "Category",
      };
    }

    if (model.layout === "categorical") {
      return {
        label: "No categories",
        value: "—",
        detail: model.categoryLabel ?? "Category",
      };
    }
  }

  if (model.kind === "distribution") {
    const strongest = [...model.bins].sort(
      (left, right) => Math.abs(right.value) - Math.abs(left.value),
    )[0];
    return strongest === undefined
      ? { label: "No bins", value: "—", detail: "Distribution" }
      : {
          label: `${formatSemanticValue(strongest.start, model.measureFormat)}–${formatSemanticValue(strongest.end, model.measureFormat)}`,
          value: formatSemanticValue(strongest.value, model.valueFormat),
          detail: "Most active range",
        };
  }

  if (model.kind === "anomaly") {
    const strongest =
      [...model.points]
        .filter((point) => point.valid && point.flagged)
        .sort((left, right) => Math.abs(right.score) - Math.abs(left.score))[0] ??
      model.points.filter((point) => point.valid).at(-1);

    return strongest === undefined
      ? { label: "No observations", value: "—", detail: model.valueLabel }
      : {
          label: formatPeriod(strongest.periodStart, model.interval),
          value: formatSemanticValue(strongest.value, model.valueFormat),
          detail: strongest.flagged ? "Strongest anomaly" : "Latest observation",
        };
  }

  const points = model.points.filter((point) => point.valid);
  const latestPeriod = Math.max(...points.map((point) => point.periodStart));
  const latest =
    points
      .filter((point) => point.periodStart === latestPeriod)
      .sort((left, right) => right.value - left.value)[0] ?? points.at(-1);
  const seriesName =
    latest === undefined ? undefined : model.seriesNames[latest.seriesIndex];

  return latest === undefined
    ? { label: "No observations", value: "—", detail: model.valueLabel }
    : {
        label: seriesName ?? model.valueLabel,
        value: formatSemanticValue(latest.value, model.valueFormat),
        detail: "Latest observation",
      };
}

function selectionDetail(
  model: SemanticVisualModel,
  selection: SemanticSelection | null,
): {
  readonly focus: ReturnType<typeof primaryValue>;
  readonly finding: string;
} | null {
  if (selection === null) {
    return null;
  }

  if (
    selection.kind === "category" &&
    (model.kind === "comparison" ||
      model.kind === "composition" ||
      model.kind === "ranking")
  ) {
    const item = model.items[selection.index];

    return item === undefined
      ? null
      : {
          focus: {
            label: item.label,
            value: formatSemanticValue(item.value, model.valueFormat),
            detail: model.categoryLabel ?? "Selected group",
          },
          finding: `${item.label} is selected at ${formatSemanticValue(item.value, model.valueFormat)}.`,
        };
  }

  if (selection.kind === "bin" && model.kind === "distribution") {
    const bin = model.bins[selection.index];

    return bin === undefined
      ? null
      : {
          focus: {
            label: `${formatSemanticValue(bin.start, model.measureFormat)}–${formatSemanticValue(bin.end, model.measureFormat)}`,
            value: formatSemanticValue(bin.value, model.valueFormat),
            detail: "Selected range",
          },
          finding: `This range contains ${formatSemanticValue(bin.value, model.valueFormat)}.`,
        };
  }

  if (selection.kind !== "period") {
    return null;
  }

  if (
    model.kind === "distribution" ||
    model.kind === "ranking" ||
    ((model.kind === "comparison" || model.kind === "composition") &&
      model.layout === "categorical")
  ) {
    return null;
  }

  const points = model.points
    .filter(
      (point) =>
        point.valid &&
        point.periodStart === selection.periodStart &&
        (selection.seriesIndex === null ||
          point.seriesIndex === selection.seriesIndex),
    )
    .sort((left, right) => Math.abs(right.value) - Math.abs(left.value));
  const point = points[0];

  if (point === undefined) {
    return null;
  }

  if (model.interval === null) {
    return null;
  }

  const seriesName = model.seriesNames[point.seriesIndex] ?? model.valueLabel;
  const period = formatPeriod(selection.periodStart, model.interval);

  return {
    focus: {
      label: seriesName,
      value: formatSemanticValue(point.value, model.valueFormat),
      detail: period,
    },
    finding: `${seriesName} reached ${formatSemanticValue(point.value, model.valueFormat)} in ${period}.`,
  };
}

function semanticDeepDiveActions(
  model: SemanticVisualModel,
  selection: SemanticSelection | null,
): readonly AnalysisDeepDiveAction[] {
  if (selection === null) {
    return [];
  }

  if (
    selection.kind === "category" &&
    (model.kind === "comparison" ||
      model.kind === "composition" ||
      model.kind === "ranking")
  ) {
    const item = model.items[selection.index];

    if (item === undefined) {
      return [];
    }

    return [
      {
        label: `Trace ${item.label} over time`,
        prompt: `Continue the current analysis by focusing on "${item.label}". Show the same measure over time.`,
      },
      {
        label: `Break down ${item.label}`,
        prompt: `Continue the current analysis by focusing on "${item.label}". Break it down by the most informative available category.`,
      },
    ];
  }

  if (selection.kind === "bin" && model.kind === "distribution") {
    const bin = model.bins[selection.index];

    if (bin === undefined) {
      return [];
    }

    const range = `${formatSemanticValue(bin.start, model.measureFormat)} to ${formatSemanticValue(bin.end, model.measureFormat)}`;

    return [
      {
        label: "Break down this range",
        prompt: `Continue the current analysis by focusing on values from ${range}. Break this range down by the most informative available category.`,
      },
      {
        label: "Trace this range over time",
        prompt: `Continue the current analysis by focusing on values from ${range}. Show how this range changes over time.`,
      },
    ];
  }

  if (selection.kind !== "period") {
    return [];
  }

  if (
    model.kind === "distribution" ||
    model.kind === "ranking" ||
    ((model.kind === "comparison" || model.kind === "composition") &&
      model.layout === "categorical") ||
    model.interval === null
  ) {
    return [];
  }

  const period = formatPeriod(selection.periodStart, model.interval);
  const point = model.points.find(
    (candidate) =>
      candidate.valid &&
      candidate.periodStart === selection.periodStart &&
      (selection.seriesIndex === null ||
        candidate.seriesIndex === selection.seriesIndex),
  );
  const series =
    point === undefined
      ? null
      : model.seriesNames[point.seriesIndex] ?? model.valueLabel;
  const focus = series === null ? period : `${series} in ${period}`;

  return [
    {
      label: `Open ${period}`,
      prompt: `Continue the current analysis by zooming into ${period}${series === null ? "" : ` for "${series}"`}. Use a finer time interval and preserve the same measure.`,
    },
    {
      label: `Break down ${period}`,
      prompt: `Continue the current analysis by focusing on ${focus}. Break it down by the most informative available category.`,
    },
  ];
}

type DashboardHighlight = {
  readonly label: string;
  readonly value: string;
};

function dashboardHighlights(
  model: SemanticVisualModel,
): readonly [DashboardHighlight, DashboardHighlight] {
  if (
    model.kind === "comparison" ||
    model.kind === "composition" ||
    model.kind === "ranking"
  ) {
    const items = "items" in model ? model.items : [];
    const ordered = [...items].sort(
      (left, right) => Math.abs(right.value) - Math.abs(left.value),
    );
    const first = ordered[0];
    const second = ordered[1];
    const gap =
      first === undefined || second === undefined
        ? null
        : Math.abs(first.value - second.value);

    return [
      {
        label: model.kind === "composition" ? "Largest share" : "Leader",
        value: first?.label ?? "—",
      },
      {
        label: second === undefined ? "Compared groups" : "Gap to next",
        value:
          gap === null
            ? String(items.length)
            : formatSemanticValue(gap, model.valueFormat),
      },
    ];
  }

  if (model.kind === "distribution") {
    const ordered = [...model.bins].sort(
      (left, right) => Math.abs(right.value) - Math.abs(left.value),
    );
    const peak = ordered[0];
    const total = model.bins.reduce((sum, bin) => sum + bin.value, 0);

    return [
      {
        label: "Most common range",
        value:
          peak === undefined
            ? "—"
            : `${formatSemanticValue(peak.start, model.measureFormat)}–${formatSemanticValue(peak.end, model.measureFormat)}`,
      },
      {
        label: "In the distribution",
        value: formatSemanticValue(total, model.valueFormat),
      },
    ];
  }

  if (model.kind === "anomaly") {
    const flagged = model.points.filter((point) => point.flagged);
    const strongest = [...flagged].sort(
      (left, right) => Math.abs(right.score) - Math.abs(left.score),
    )[0];

    return [
      {
        label: "Unusual movements",
        value: flagged.length.toLocaleString(),
      },
      {
        label: "Strongest signal",
        value:
          strongest === undefined
            ? "None"
            : formatPeriod(strongest.periodStart, model.interval),
      },
    ];
  }

  const valid = model.points
    .filter((point) => point.valid)
    .sort((left, right) => left.periodStart - right.periodStart);
  const first = valid[0];
  const last = valid.at(-1);
  const peak = [...valid].sort(
    (left, right) => Math.abs(right.value) - Math.abs(left.value),
  )[0];
  const change =
    first === undefined || last === undefined || first.value === 0
      ? null
      : ((last.value - first.value) / Math.abs(first.value)) * 100;

  return [
    {
      label: "Change over the range",
      value: change === null ? "—" : `${change >= 0 ? "+" : ""}${change.toFixed(1)}%`,
    },
    {
      label: "Peak period",
      value:
        peak === undefined
          ? "—"
          : formatPeriod(peak.periodStart, model.interval),
    },
  ];
}

function SemanticVisualResult({
  loaded,
}: {
  readonly loaded: SemanticLoadResult;
}) {
  const model = loaded.model;
  const [selection, setSelection] = useState<SemanticSelection | null>(null);
  const selected = selectionDetail(model, selection);
  const deepDiveActions = semanticDeepDiveActions(model, selection);
  const focus = selected?.focus ?? primaryValue(model);
  const finding = selected?.finding ?? model.explanation;
  const highlights = dashboardHighlights(model);
  const mainWidth =
    model.kind === "distribution" || model.kind === "anomaly"
      ? "lg:col-span-7"
      : "lg:col-span-8";
  const sideWidth =
    model.kind === "distribution" || model.kind === "anomaly"
      ? "lg:col-span-5"
      : "lg:col-span-4";

  return (
    <LivingDashboard title={model.title}>
    <article
      className="analysis-bento content-start dashboard-revealing"
      data-dashboard-kind={model.kind}
    >
      <section
        aria-label={model.title}
        className={`analysis-tile col-span-12 min-h-[22rem] p-6 ${mainWidth}`}
        data-living-role="focus"
      >
        <header className="mb-5 flex items-start justify-between gap-6">
          <div>
            <p className="text-[11px] font-semibold capitalize text-[#697cc7]">
              {model.kind}
            </p>
            <h2 className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-[var(--ink)]">
              {model.title}
            </h2>
          </div>
          <div className="flex items-center gap-2">
            {selection !== null && (
              <button
                className="rounded-full border border-[var(--line)] bg-white/68 px-3 py-1.5 text-[10px] font-semibold text-[var(--ink-secondary)] transition-colors hover:bg-white"
                onClick={() => setSelection(null)}
                type="button"
              >
                Reset focus
              </button>
            )}
            <span className="rounded-full bg-[#8796d6]/10 px-3 py-1.5 text-[10px] font-semibold text-[#5c6db0]">
              {selection === null ? "Interactive" : "Selection linked"}
            </span>
          </div>
        </header>
        <MainVisual
          model={model}
          onSelect={(nextSelection) => setSelection(nextSelection)}
          selection={selection}
        />
        <DeepDiveActions
          actions={deepDiveActions}
          prompt="Select a point, lane, or range to reveal deeper views."
        />
      </section>

      <aside
        className={`col-span-12 grid gap-3 ${sideWidth} lg:grid-rows-2`}
        data-living-role="context"
      >
        <section className="brand-hero analysis-tile relative flex min-h-36 flex-col justify-between overflow-hidden p-5">
          <div className="relative z-10">
            <p className="text-[11px] text-[var(--ink-tertiary)]">{focus.detail}</p>
            <p
              aria-live="polite"
              className="mt-3 break-words text-2xl font-semibold tracking-[-0.045em] text-[var(--ink)]"
            >
              {focus.value}
            </p>
          </div>
          <div className="relative z-10 mt-6">
            <p className="truncate text-sm font-semibold text-[var(--ink)]">
              {focus.label}
            </p>
            <div className="optical-rule mt-3 h-0.5 w-16 rounded-full" />
          </div>
        </section>

        <section className="analysis-tile flex min-h-36 flex-col justify-between p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-[11px] text-[var(--ink-tertiary)]">Lens finding</p>
              <p className="mt-3 line-clamp-2 text-base font-semibold leading-5 tracking-[-0.025em] text-[var(--ink)]">
                {finding}
              </p>
            </div>
            <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-[#21c5be]/10 text-[#168f8a]">
              <Zap aria-hidden="true" className="size-4" />
            </span>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2">
            {highlights.map((highlight) => (
              <div className="analysis-tile-quiet p-2.5" key={highlight.label}>
                <p className="text-[9px] text-[var(--ink-tertiary)]">
                  {highlight.label}
                </p>
                <p className="mt-2 truncate text-xs font-semibold text-[var(--ink)]">
                  {highlight.value}
                </p>
              </div>
            ))}
          </div>
        </section>
      </aside>

      <AnalysisEvidenceLink />
    </article>
    </LivingDashboard>
  );
}

export function SemanticAnalysisResult({
  output,
}: SemanticAnalysisResultProps) {
  const readyRequest = output.status === "ready" ? output.request : null;
  const arenaAnalysis = useMemo<QueryArenaRequest | null>(() => {
    if (readyRequest === null) {
      return null;
    }

    const parsed = queryArenaSemanticRequestSchema.safeParse(readyRequest);
    return parsed.success
      ? { kind: "semantic", request: parsed.data }
      : null;
  }, [readyRequest]);
  const { failAnalysis } = useAnalysisPerformance();

  useEffect(() => {
    if (output.status === "unsupported") {
      failAnalysis("agent", output.error.message);
    }
  }, [failAnalysis, output]);

  if (output.status === "unsupported") {
    return (
      <section className="glass-panel rounded-2xl p-5" role="alert">
        <p className="text-sm font-medium text-[var(--ink)]">
          This analysis is not available for this dataset.
        </p>
        <p className="mt-1 text-sm text-[var(--ink-tertiary)]">
          {output.error.message}
        </p>
      </section>
    );
  }

  return (
    <ReadySemanticAnalysis
      arenaAnalysis={arenaAnalysis}
      output={output}
    />
  );
}

function ReadySemanticAnalysis({
  arenaAnalysis,
  output,
}: {
  readonly arenaAnalysis: QueryArenaRequest | null;
  readonly output: Extract<SemanticAnalysisToolOutput, { status: "ready" }>;
}) {
  const { failAnalysis, reportAnalysis } = useAnalysisPerformance();
  const query = useQuery({
    queryKey: ["semantic-analysis", output.request],
    queryFn: async () => loadSemanticAnalysis(output.request),
    retry: false,
  });

  useEffect(() => {
    if (query.data?.isOk() !== true) {
      return;
    }

    const loaded = query.data.value;
    reportAnalysis({
      title: output.request.plan.title,
      kind: output.request.plan.operation,
      queryId: loaded.queryId,
      contract: loaded.arrowContract,
      arrowBytes: loaded.arrowBytes,
      typedRows: semanticRowCount(loaded.model),
      roundTripMs: loaded.roundTripMs,
      wasmStartupMs: loaded.wasmStartupMs,
      rustDecodeMs: loaded.rustDecodeMs,
      rustComputeMs: loaded.rustTransformMs,
    });
  }, [
    output.request.plan.operation,
    output.request.plan.title,
    query.data,
    reportAnalysis,
  ]);

  useEffect(() => {
    if (query.isError) {
      failAnalysis("clickhouse", "The semantic analysis failed unexpectedly.");
      return;
    }

    if (query.data?.isErr() === true) {
      const stage =
        query.data.error.kind === "semantic-wasm" ||
        query.data.error.kind === "semantic-adapter"
          ? "rust"
          : "clickhouse";
      failAnalysis(stage, query.data.error.message);
    }
  }, [failAnalysis, query.data, query.isError]);

  if (query.isPending) {
    return (
      <div className="h-full min-h-[24rem]">
        <DashboardAssembly settling={false} />
      </div>
    );
  }

  if (query.isError) {
    return (
      <p
        className="glass-panel rounded-2xl p-5 text-sm text-destructive"
        role="alert"
      >
        The semantic analysis failed unexpectedly.
      </p>
    );
  }

  if (query.data.isErr()) {
    return (
      <section className="glass-panel space-y-2 rounded-2xl p-5" role="alert">
        <p className="text-sm font-medium">The analysis could not be loaded.</p>
        <p className="text-sm text-muted-foreground">
          {query.data.error.message}
        </p>
      </section>
    );
  }

  const loaded = query.data.value;
  return (
    <>
      {loaded.queryId !== null && arenaAnalysis !== null && (
        <QueryArenaReporter
          analysis={arenaAnalysis}
          currentStrategy={loaded.strategy}
          queryId={loaded.queryId}
        />
      )}
      <SemanticVisualResult loaded={loaded} />
    </>
  );
}
