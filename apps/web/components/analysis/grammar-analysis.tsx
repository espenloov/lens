"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { useAnalysisPerformance } from "@/components/analysis/performance-context";
import {
  DeepDiveActions,
  type AnalysisDeepDiveAction,
} from "@/components/analysis/analysis-exploration";
import { DashboardAssembly } from "@/components/dashboard-assembly";
import type { AnalysisPlan } from "@/lib/analysis/contracts";
import type {
  CategoricalRequest,
  HistogramRequest,
  MatrixRequest,
} from "@/lib/analysis/execution";
import {
  loadGrammarAnalysis,
  type GrammarAnalysisRequest,
} from "@/lib/analysis/load";
import type {
  CategoryFrame,
  HistogramFrame,
  MatrixFrame,
} from "@/lib/wasm/analysis";

import {
  formatCompactCount,
  formatCompactPrice,
  formatCount,
  formatPrice,
} from "./formatters";
import { AnalysisEvidenceLink } from "./analysis-evidence-link";
import { InsightHeader } from "./insight-header";
import { LivingDashboard } from "./living-dashboard";

type GrammarAnalysisProps = {
  readonly plan: AnalysisPlan;
  readonly request: GrammarAnalysisRequest;
};

function formatValue(
  value: number,
  request: GrammarAnalysisRequest,
  compact = false,
) {
  if (request.shape === "categorical" && request.transform === "share") {
    return `${value.toFixed(1)}%`;
  }

  if (request.shape === "histogram" || request.metric === "transaction_count") {
    return compact
      ? formatCompactCount(value)
      : formatCount(Math.round(value));
  }

  return compact ? formatCompactPrice(value) : formatPrice(value);
}

function CategoryView({
  frame,
  onSelect,
  request,
  selectedRow,
}: {
  readonly frame: CategoryFrame;
  readonly onSelect: (row: number) => void;
  readonly request: CategoricalRequest;
  readonly selectedRow: number | null;
}) {
  const maximum = Math.max(...frame.values.map((value) => Math.abs(value)), 1);

  return (
    <div className="semantic-category-field">
      {frame.categories.slice(0, 8).map((category, index) => {
        const ratio = Math.abs(frame.values[index]) / maximum;

        return (
          <button
            aria-pressed={selectedRow === index}
            className="semantic-category-item"
            key={category}
            onClick={() => onSelect(index)}
            style={{
              opacity:
                selectedRow === null || selectedRow === index ? 1 : 0.34,
            }}
            type="button"
          >
            <span className="semantic-category-label">{category}</span>
            <span aria-hidden="true" className="semantic-category-track">
              <span
                className="semantic-category-fill"
                style={{
                  background: SERIES_COLORS[index % SERIES_COLORS.length],
                  width: `${ratio * 100}%`,
                }}
              />
              <span
                className="semantic-category-orb"
                style={{
                  background: SERIES_COLORS[index % SERIES_COLORS.length],
                  left: `${ratio * 100}%`,
                }}
              />
            </span>
            <span className="semantic-category-value">
              {formatValue(frame.values[index], request)}
            </span>
          </button>
        );
      })}
    </div>
  );
}

const SERIES_COLORS = ["#697cc7", "#21c5be", "#ef9ca5", "#e3a53b", "#885cf6"];

function HistogramView({
  frame,
  onSelect,
  request,
  selectedRow,
}: {
  readonly frame: HistogramFrame;
  readonly onSelect: (row: number) => void;
  readonly request: HistogramRequest;
  readonly selectedRow: number | null;
}) {
  const gradientId = useId();
  const glowId = useId();
  const maximum = Math.max(...frame.values.map((value) => Math.abs(value)), 1);
  const overflowStart =
    (request.filters.minimumPrice ?? 0) +
    (request.maximumBins - 1) * request.bucketWidth;
  const width = 760;
  const height = 250;
  const padding = 12;
  const uniqueBins = [...new Set(frame.binStarts)].sort(
    (left, right) => left - right,
  );
  const x = (binStart: number) => {
    const index = uniqueBins.indexOf(binStart);

    return uniqueBins.length <= 1
      ? width / 2
      : padding +
          (index / (uniqueBins.length - 1)) * (width - padding * 2);
  };
  const y = (value: number) =>
    height -
    padding -
    (Math.abs(value) / maximum) * (height - padding * 2);
  const seriesIndexes = [...new Set(frame.seriesIndexes)];
  const paths = seriesIndexes.map((seriesIndex) => {
    const rows = Array.from(
      { length: frame.values.length },
      (_, row) => row,
    )
      .filter((row) => frame.seriesIndexes[row] === seriesIndex)
      .sort((left, right) => frame.binStarts[left] - frame.binStarts[right]);
    const line = rows
      .map(
        (row, index) =>
          `${index === 0 ? "M" : "L"} ${x(frame.binStarts[row])} ${y(frame.values[row])}`,
      )
      .join(" ");
    const area =
      rows.length === 0
        ? ""
        : `${line} L ${x(frame.binStarts[rows.at(-1)!])} ${height - padding} L ${x(frame.binStarts[rows[0]])} ${height - padding} Z`;

    return { area, line, rows, seriesIndex };
  });
  const selected =
    selectedRow === null
      ? null
      : {
          x: x(frame.binStarts[selectedRow]),
          y: y(frame.values[selectedRow]),
        };

  return (
    <div className="semantic-density-field min-w-0">
      <svg
        aria-label="Interactive price distribution landscape"
        className="h-52 w-full overflow-visible"
        role="img"
        viewBox={`0 0 ${width} ${height}`}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#697cc7" stopOpacity="0.38" />
            <stop offset="100%" stopColor="#21c5be" stopOpacity="0.03" />
          </linearGradient>
          <filter id={glowId} x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur result="blur" stdDeviation="5" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        {paths.map(({ area, line, rows, seriesIndex }, seriesPosition) => (
          <g key={seriesIndex}>
            {seriesPosition === 0 && (
              <path d={area} fill={`url(#${gradientId})`} />
            )}
            <path
              className="living-trace-line"
              d={line}
              fill="none"
              pathLength="1"
              stroke={SERIES_COLORS[seriesPosition % SERIES_COLORS.length]}
              strokeLinejoin="round"
              strokeWidth="3"
            />
            {rows.map((row) => (
              <circle
                className="cursor-crosshair"
                cx={x(frame.binStarts[row])}
                cy={y(frame.values[row])}
                fill="transparent"
                key={row}
                onClick={() => onSelect(row)}
                onPointerEnter={() => onSelect(row)}
                r="10"
              >
                <title>
                  {frame.binStarts[row] === overflowStart
                    ? `${formatPrice(frame.binStarts[row])}+`
                    : `${formatPrice(frame.binStarts[row])}–${formatPrice(frame.binEnds[row])}`}
                  : {formatValue(frame.values[row], request)}
                </title>
              </circle>
            ))}
          </g>
        ))}
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
              filter={`url(#${glowId})`}
              r="6"
              stroke="white"
              strokeWidth="3"
            />
          </g>
        )}
      </svg>
      <div className="mt-2 grid grid-cols-[auto_minmax(6rem,1fr)_auto] items-center gap-3 text-xs text-[#66758e]">
        <span>{formatPrice(frame.binStarts[0])}</span>
        <input
          aria-label="Inspect a price band"
          className="w-full accent-[#697cc7]"
          max={Math.max(0, frame.values.length - 1)}
          min="0"
          onChange={(event) => onSelect(Number(event.target.value))}
          type="range"
          value={selectedRow ?? 0}
        />
        <span>{formatPrice(frame.binStarts.at(-1) ?? 0)}+</span>
      </div>
    </div>
  );
}

function MatrixView({
  frame,
  onSelect,
  request,
  selectedRow,
}: {
  readonly frame: MatrixFrame;
  readonly onSelect: (row: number) => void;
  readonly request: MatrixRequest;
  readonly selectedRow: number | null;
}) {
  const cells = useMemo(
    () =>
      new Map(
        Array.from({ length: frame.values.length }, (_, row) => [
          `${frame.xIndexes[row]}:${frame.yIndexes[row]}`,
          row,
        ]),
      ),
    [frame],
  );
  const maximum = Math.max(...frame.values, 1);

  return (
    <div className="space-y-4 overflow-x-auto">
      <div
        className="grid min-w-max gap-1"
        style={{ gridTemplateColumns: `8rem repeat(${frame.xLabels.length}, minmax(3.5rem, 1fr))` }}
      >
        <div />
        {frame.xLabels.map((label) => (
          <div className="px-1 pb-2 text-center text-xs text-muted-foreground" key={label}>
            {label}
          </div>
        ))}
        {frame.yLabels.flatMap((yLabel, yIndex) => [
          <div className="flex items-center pr-2 text-xs font-medium" key={`${yLabel}-label`}>
            {yLabel}
          </div>,
          ...frame.xLabels.map((xLabel, xIndex) => {
            const row = cells.get(`${xIndex}:${yIndex}`);
            const value = row === undefined ? 0 : frame.values[row];
            const intensity = Math.max(0.06, value / maximum);

            const diameter = Math.max(
              0.55,
              Math.sqrt(Math.max(0, value / maximum)) * 2.35,
            );

            return (
              <button
                aria-label={`${xLabel}, ${yLabel}: ${formatValue(value, request)}`}
                aria-pressed={selectedRow === row}
                className="grammar-signal-cell"
                key={`${xLabel}-${yLabel}`}
                onClick={() => row !== undefined && onSelect(row)}
                onPointerEnter={() => row !== undefined && onSelect(row)}
                title={`${xLabel}, ${yLabel}: ${formatValue(value, request)}`}
                type="button"
              >
                {row === undefined ? (
                  <span className="text-[10px] text-[var(--ink-tertiary)]">
                    —
                  </span>
                ) : (
                  <span
                    className="grammar-signal-orb"
                    style={{
                      backgroundColor: `color-mix(in oklab, var(--trigger) ${intensity * 75}%, var(--lens-blue))`,
                      height: `${diameter}rem`,
                      width: `${diameter}rem`,
                    }}
                  />
                )}
              </button>
            );
          }),
        ])}
      </div>
      <details>
        <summary className="cursor-pointer text-sm font-medium">
          View accessible heatmap table
        </summary>
        <table className="mt-3 w-full min-w-max text-left text-sm">
          <thead>
            <tr className="border-b">
              <th className="py-2 pr-4">X</th>
              <th className="py-2 pr-4">Y</th>
              <th className="py-2 text-right">Value</th>
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: frame.values.length }, (_, row) => (
              <tr className="border-b" key={`${frame.xIndexes[row]}-${frame.yIndexes[row]}`}>
                <td className="py-2 pr-4">{frame.xLabels[frame.xIndexes[row]]}</td>
                <td className="py-2 pr-4">{frame.yLabels[frame.yIndexes[row]]}</td>
                <td className="py-2 text-right tabular-nums">
                  {formatValue(frame.values[row], request)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}

type GrammarDashboardHighlight = {
  readonly focusLabel: string;
  readonly focusValue: string;
  readonly focusDetail: string;
  readonly secondaryLabel: string;
  readonly secondaryValue: string;
  readonly tertiaryLabel: string;
  readonly tertiaryValue: string;
  readonly finding: string;
};

function grammarDashboardHighlight(
  frame: CategoryFrame | HistogramFrame | MatrixFrame,
  request: GrammarAnalysisRequest,
  selectedRow: number | null,
): GrammarDashboardHighlight {
  const orderedRows = Array.from(
    { length: frame.values.length },
    (_, index) => index,
  ).sort((left, right) => frame.values[right] - frame.values[left]);
  const strongestRow = selectedRow ?? orderedRows[0] ?? 0;
  const secondRow = orderedRows.find((row) => row !== strongestRow);
  const strongestValue = frame.values[strongestRow] ?? 0;
  const total = frame.values.reduce((sum, value) => sum + value, 0);

  if (frame.kind === "categorical" && request.shape === "categorical") {
    const secondValue =
      secondRow === undefined ? null : frame.values[secondRow] ?? null;
    const gap =
      secondValue === null ? null : Math.abs(strongestValue - secondValue);
    const share = total === 0 ? null : (strongestValue / total) * 100;

    return {
      focusLabel:
        selectedRow !== null
          ? "Selected group"
          : request.transform === "share"
          ? "Largest share"
          : request.metric === "transaction_count"
            ? "Most active group"
            : "Highest value",
      focusValue: formatValue(strongestValue, request),
      focusDetail: frame.categories[strongestRow] ?? "—",
      secondaryLabel: secondValue === null ? "Groups compared" : "Gap to next",
      secondaryValue:
        gap === null
          ? frame.categories.length.toLocaleString()
          : formatValue(gap, request),
      tertiaryLabel: "Share of the result",
      tertiaryValue: share === null ? "—" : `${share.toFixed(1)}%`,
      finding:
        selectedRow !== null
          ? `${frame.categories[strongestRow] ?? "This group"} represents ${share === null ? formatValue(strongestValue, request) : `${share.toFixed(1)}% of the result`}.`
          : gap === null
          ? `${frame.categories[strongestRow] ?? "The leading group"} has the highest value.`
          : `${frame.categories[strongestRow] ?? "The leading group"} leads the next group by ${formatValue(gap, request)}.`,
    };
  }

  if (frame.kind === "histogram" && request.shape === "histogram") {
    const overflowStart =
      (request.filters.minimumPrice ?? 0) +
      (request.maximumBins - 1) * request.bucketWidth;
    const overflow = frame.binStarts[strongestRow] === overflowStart;
    const label = overflow
      ? `${formatPrice(frame.binStarts[strongestRow])}+`
      : `${formatPrice(frame.binStarts[strongestRow])}–${formatPrice(frame.binEnds[strongestRow])}`;
    const share = total === 0 ? null : (strongestValue / total) * 100;
    const millionPlus = frame.values.reduce(
      (sum, value, index) =>
        sum + (frame.binStarts[index] >= 1_000_000 ? value : 0),
      0,
    );

    return {
      focusLabel: selectedRow === null ? "Most common range" : "Selected range",
      focusValue: label,
      focusDetail: `${formatCount(Math.round(strongestValue))} sales`,
      secondaryLabel: "In this range",
      secondaryValue: share === null ? "—" : `${share.toFixed(1)}%`,
      tertiaryLabel: "£1m+ sales",
      tertiaryValue: formatCount(Math.round(millionPlus)),
      finding:
        selectedRow === null
          ? `${label} is the largest price band, containing ${share === null ? "the most" : `${share.toFixed(1)}% of`} recorded sales.`
          : `${label} contains ${share === null ? formatCount(Math.round(strongestValue)) : `${share.toFixed(1)}% of`} recorded sales.`,
    };
  }

  const matrix = frame as MatrixFrame;
  const secondValue =
    secondRow === undefined ? null : matrix.values[secondRow] ?? null;
  const gap =
    secondValue === null ? null : Math.abs(strongestValue - secondValue);

  return {
    focusLabel:
      selectedRow === null ? "Strongest intersection" : "Selected intersection",
    focusValue: formatValue(strongestValue, request),
    focusDetail: `${matrix.xLabels[matrix.xIndexes[strongestRow]]} · ${matrix.yLabels[matrix.yIndexes[strongestRow]]}`,
    secondaryLabel: "Gap to next",
    secondaryValue: gap === null ? "—" : formatValue(gap, request),
    tertiaryLabel: "Combinations",
    tertiaryValue: matrix.values.length.toLocaleString(),
    finding:
      selectedRow === null
        ? `${matrix.xLabels[matrix.xIndexes[strongestRow]]} with ${matrix.yLabels[matrix.yIndexes[strongestRow]]} is the strongest intersection.`
        : `${matrix.xLabels[matrix.xIndexes[strongestRow]]} with ${matrix.yLabels[matrix.yIndexes[strongestRow]]} has a value of ${formatValue(strongestValue, request)}.`,
  };
}

function grammarDeepDiveActions(
  frame: CategoryFrame | HistogramFrame | MatrixFrame,
  request: GrammarAnalysisRequest,
  selectedRow: number | null,
): readonly AnalysisDeepDiveAction[] {
  if (selectedRow === null) {
    return [];
  }

  if (frame.kind === "categorical" && request.shape === "categorical") {
    const category = frame.categories[selectedRow];

    return category === undefined
      ? []
      : [
          {
            label: `Trace ${category} over time`,
            prompt: `Continue the current analysis by focusing on "${category}". Show the same measure over time.`,
          },
          {
            label: `Break down ${category}`,
            prompt: `Continue the current analysis by focusing on "${category}". Break it down by the most informative available category.`,
          },
        ];
  }

  if (frame.kind === "histogram" && request.shape === "histogram") {
    const start = frame.binStarts[selectedRow];
    const end = frame.binEnds[selectedRow];

    if (start === undefined || end === undefined) {
      return [];
    }

    return [
      {
        label: "Break down this range",
        prompt: `Continue the current analysis by focusing on values from ${formatPrice(start)} to ${formatPrice(end)}. Break this range down by the most informative available category.`,
      },
      {
        label: "Trace this range over time",
        prompt: `Continue the current analysis by focusing on values from ${formatPrice(start)} to ${formatPrice(end)}. Show how this range changes over time.`,
      },
    ];
  }

  if (frame.kind !== "matrix" || request.shape !== "matrix") {
    return [];
  }

  const xLabel = frame.xLabels[frame.xIndexes[selectedRow]];
  const yLabel = frame.yLabels[frame.yIndexes[selectedRow]];

  if (xLabel === undefined || yLabel === undefined) {
    return [];
  }

  return [
    {
      label: "Trace this intersection",
      prompt: `Continue the current analysis by focusing on "${xLabel}" with "${yLabel}". Show the same measure over time.`,
    },
    {
      label: "Explain this intersection",
      prompt: `Continue the current analysis by focusing on "${xLabel}" with "${yLabel}". Compare it with the nearest relevant groups.`,
    },
  ];
}

export function GrammarAnalysis({ plan, request }: GrammarAnalysisProps) {
  const { failAnalysis, reportAnalysis } = useAnalysisPerformance();
  const [selectedRow, setSelectedRow] = useState<number | null>(null);
  const query = useQuery({
    queryKey: ["grammar-analysis", request],
    queryFn: async () => loadGrammarAnalysis(request),
    retry: false,
  });

  useEffect(() => {
    if (query.data?.isOk() !== true) {
      return;
    }

    const loaded = query.data.value;
    reportAnalysis({
      title: plan.title,
      kind: request.operation,
      queryId: loaded.queryId,
      contract: loaded.arrowContract ?? `${request.shape}/v1`,
      arrowBytes: loaded.arrowBytes,
      typedRows: loaded.frame.values.length,
      roundTripMs: loaded.roundTripMs,
      wasmStartupMs: loaded.wasmStartupMs,
      rustDecodeMs: loaded.rustDecodeMs,
      rustComputeMs: 0,
    });
  }, [
    plan.title,
    query.data,
    reportAnalysis,
    request.operation,
    request.shape,
  ]);

  useEffect(() => {
    if (query.isError) {
      failAnalysis("clickhouse", "The analysis request failed unexpectedly.");
      return;
    }

    if (query.data?.isErr() === true) {
      failAnalysis(
        query.data.error.kind === "analysis-wasm" ? "rust" : "clickhouse",
        query.data.error.message,
      );
    }
  }, [failAnalysis, query.data, query.isError]);

  if (query.isPending) {
    return (
      <div className="h-full min-h-[24rem]">
        <DashboardAssembly settling={false} />
      </div>
    );
  }

  if (query.isError || query.data.isErr()) {
    return (
      <p className="glass-panel rounded-2xl p-5 text-sm text-destructive" role="alert">
        The analysis frame could not be loaded.
      </p>
    );
  }

  const loaded = query.data.value;
  const highlight = grammarDashboardHighlight(
    loaded.frame,
    request,
    selectedRow,
  );
  const deepDiveActions = grammarDeepDiveActions(
    loaded.frame,
    request,
    selectedRow,
  );
  const mainWidth =
    loaded.frame.kind === "matrix" ? "lg:col-span-7" : "lg:col-span-8";
  const sideWidth =
    loaded.frame.kind === "matrix" ? "lg:col-span-5" : "lg:col-span-4";

  if (loaded.frame.values.length === 0) {
    return (
      <section className="glass-panel space-y-2 rounded-2xl p-6">
        <h2 className="text-xl font-medium">{plan.title}</h2>
        <p className="text-sm text-muted-foreground">
          No transactions matched this analysis.
        </p>
      </section>
    );
  }

  return (
    <LivingDashboard title={plan.title}>
    <article className="dashboard-revealing space-y-3">
      <div className="analysis-bento">
      <section
        className={`analysis-tile col-span-12 p-5 sm:p-7 ${mainWidth}`}
        data-living-role="focus"
      >
        <div className="mb-5 border-b border-[#09265b]/8 pb-4">
          <InsightHeader
            eyebrow={plan.operation}
            explanation={plan.explanation}
            title={plan.title}
          />
        </div>
        {loaded.frame.kind === "categorical" && request.shape === "categorical" && (
          <CategoryView
            frame={loaded.frame}
            onSelect={setSelectedRow}
            request={request}
            selectedRow={selectedRow}
          />
        )}
        {loaded.frame.kind === "histogram" && request.shape === "histogram" && (
          <HistogramView
            frame={loaded.frame}
            onSelect={setSelectedRow}
            request={request}
            selectedRow={selectedRow}
          />
        )}
        {loaded.frame.kind === "matrix" && request.shape === "matrix" && (
          <MatrixView
            frame={loaded.frame}
            onSelect={setSelectedRow}
            request={request}
            selectedRow={selectedRow}
          />
        )}
        <DeepDiveActions
          actions={deepDiveActions}
          prompt="Select a lane, range, or intersection to reveal deeper views."
        />
      </section>

      <aside
        className={`col-span-12 grid gap-3 ${sideWidth} lg:grid-rows-2`}
        data-living-role="context"
      >
        <section className="brand-hero analysis-tile relative flex min-h-36 flex-col justify-between overflow-hidden p-5">
          <div className="relative z-10">
            <p className="text-[11px] text-[var(--ink-tertiary)]">
              {highlight.focusLabel}
            </p>
            <p
              aria-live="polite"
              className="mt-3 break-words text-2xl font-semibold tracking-[-0.045em] text-[var(--ink)]"
            >
              {highlight.focusValue}
            </p>
          </div>
          <p className="relative z-10 mt-6 text-sm font-semibold text-[var(--ink)]">
            {highlight.focusDetail}
          </p>
        </section>

        <section className="analysis-tile flex min-h-36 flex-col justify-between p-5">
          <div>
            <p className="text-[11px] text-[var(--ink-tertiary)]">
              Lens finding
            </p>
            <p className="mt-3 line-clamp-3 text-sm font-semibold leading-5 text-[var(--ink)]">
              {highlight.finding}
            </p>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2">
            <div className="analysis-tile-quiet p-2.5">
              <p className="text-[9px] text-[var(--ink-tertiary)]">
                {highlight.secondaryLabel}
              </p>
              <p className="mt-2 truncate text-xs font-semibold text-[var(--ink)]">
                {highlight.secondaryValue}
              </p>
            </div>
            <div className="analysis-tile-quiet p-2.5">
              <p className="text-[9px] text-[var(--ink-tertiary)]">
                {highlight.tertiaryLabel}
              </p>
              <p className="mt-2 truncate text-xs font-semibold text-[var(--ink)]">
                {highlight.tertiaryValue}
              </p>
            </div>
          </div>
        </section>
      </aside>

      <AnalysisEvidenceLink />
      </div>
    </article>
    </LivingDashboard>
  );
}
