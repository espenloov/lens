"use client";

import { useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import { useAnalysisPerformance } from "@/components/analysis/performance-context";
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
  request,
}: {
  readonly frame: CategoryFrame;
  readonly request: CategoricalRequest;
}) {
  const maximum = Math.max(...frame.values, 1);

  return (
    <div>
      <div className="space-y-3">
        {frame.categories.map((category, index) => (
          <div className="grid grid-cols-[minmax(7rem,0.7fr)_2fr_auto] items-center gap-3" key={category}>
            <span className="truncate text-sm font-medium text-slate-700">{category}</span>
            <div className="h-8 overflow-hidden rounded-full bg-white/45 shadow-inner shadow-slate-300/20">
              <div
                className="h-full rounded-full bg-[#1769df] transition-[width] duration-500 motion-reduce:transition-none"
                style={{ width: `${(frame.values[index] / maximum) * 100}%` }}
              />
            </div>
            <span className="min-w-20 text-right font-mono text-sm tabular-nums text-slate-700">
              {formatValue(frame.values[index], request)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function HistogramView({
  frame,
  request,
}: {
  readonly frame: HistogramFrame;
  readonly request: HistogramRequest;
}) {
  const maximum = Math.max(...frame.values, 1);
  const overflowStart =
    (request.filters.minimumPrice ?? 0) +
    (request.maximumBins - 1) * request.bucketWidth;

  return (
    <div className="min-w-0">
        <div className="flex h-52 items-end gap-px border-b border-[#09265b]/10" aria-label="Price distribution histogram" role="img">
          {Array.from({ length: frame.values.length }, (_, row) => {
            const series = frame.seriesNames[frame.seriesIndexes[row]];
            const overflow = frame.binStarts[row] === overflowStart;
            const label = overflow
              ? `${formatPrice(frame.binStarts[row])}+`
              : `${formatPrice(frame.binStarts[row])}–${formatPrice(frame.binEnds[row])}`;

            return (
              <div
                className="min-w-0 flex-1 bg-[#1769df]"
                key={`${label}-${series}`}
                style={{ height: `${(frame.values[row] / maximum) * 100}%` }}
                title={`${label}${frame.seriesNames.length > 1 ? ` · ${series}` : ""}: ${formatValue(frame.values[row], request)}`}
              />
            );
          })}
        </div>
        <div className="mt-3 flex justify-between text-xs text-[#66758e]">
          <span>{formatPrice(frame.binStarts[0])}</span>
          <span>{formatPrice(frame.binStarts.at(-1) ?? 0)}+</span>
        </div>
        <details className="mt-3 text-sm text-[#596983]">
          <summary className="cursor-pointer font-medium text-[#1769df]">View price bands</summary>
          <div className="mt-3 max-h-56 overflow-auto">
            {Array.from({ length: frame.values.length }, (_, row) => (
              <div className="flex justify-between border-b border-[#09265b]/8 py-2 text-xs" key={row}>
                <span>{formatPrice(frame.binStarts[row])}{frame.binStarts[row] === overflowStart ? "+" : ""}</span>
                <span className="tabular-nums">{formatValue(frame.values[row], request)}</span>
              </div>
            ))}
          </div>
        </details>
    </div>
  );
}

function MatrixView({
  frame,
  request,
}: {
  readonly frame: MatrixFrame;
  readonly request: MatrixRequest;
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

            return (
              <div
                className="grid aspect-square min-h-12 place-items-center rounded-xl border border-white/65 text-[11px] tabular-nums shadow-sm"
                key={`${xLabel}-${yLabel}`}
                style={{ backgroundColor: `color-mix(in oklab, var(--trigger) ${intensity * 78}%, rgba(255,255,255,.48))`, color: intensity > 0.58 ? "white" : "var(--foreground)" }}
                title={`${xLabel}, ${yLabel}: ${formatValue(value, request)}`}
              >
                {row === undefined ? "—" : formatValue(value, request, true)}
              </div>
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
): GrammarDashboardHighlight {
  const orderedRows = Array.from(
    { length: frame.values.length },
    (_, index) => index,
  ).sort((left, right) => frame.values[right] - frame.values[left]);
  const strongestRow = orderedRows[0] ?? 0;
  const secondRow = orderedRows[1];
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
        request.transform === "share"
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
        gap === null
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
      focusLabel: "Most common range",
      focusValue: label,
      focusDetail: `${formatCount(Math.round(strongestValue))} sales`,
      secondaryLabel: "In this range",
      secondaryValue: share === null ? "—" : `${share.toFixed(1)}%`,
      tertiaryLabel: "£1m+ sales",
      tertiaryValue: formatCount(Math.round(millionPlus)),
      finding: `${label} is the largest price band, containing ${share === null ? "the most" : `${share.toFixed(1)}% of`} recorded sales.`,
    };
  }

  const matrix = frame as MatrixFrame;
  const secondValue =
    secondRow === undefined ? null : matrix.values[secondRow] ?? null;
  const gap =
    secondValue === null ? null : Math.abs(strongestValue - secondValue);

  return {
    focusLabel: "Strongest intersection",
    focusValue: formatValue(strongestValue, request),
    focusDetail: `${matrix.xLabels[matrix.xIndexes[strongestRow]]} · ${matrix.yLabels[matrix.yIndexes[strongestRow]]}`,
    secondaryLabel: "Gap to next",
    secondaryValue: gap === null ? "—" : formatValue(gap, request),
    tertiaryLabel: "Combinations",
    tertiaryValue: matrix.values.length.toLocaleString(),
    finding: `${matrix.xLabels[matrix.xIndexes[strongestRow]]} with ${matrix.yLabels[matrix.yIndexes[strongestRow]]} is the strongest intersection.`,
  };
}

export function GrammarAnalysis({ plan, request }: GrammarAnalysisProps) {
  const { failAnalysis, reportAnalysis } = useAnalysisPerformance();
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
  const highlight = grammarDashboardHighlight(loaded.frame, request);
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
    <article className="dashboard-revealing space-y-3">
      <div className="analysis-bento">
      <section className={`analysis-tile col-span-12 p-5 sm:p-7 ${mainWidth}`}>
        <div className="mb-5 border-b border-[#09265b]/8 pb-4">
          <InsightHeader
            eyebrow={plan.operation}
            explanation={plan.explanation}
            title={plan.title}
          />
        </div>
        {loaded.frame.kind === "categorical" && request.shape === "categorical" && (
          <CategoryView frame={loaded.frame} request={request} />
        )}
        {loaded.frame.kind === "histogram" && request.shape === "histogram" && (
          <HistogramView frame={loaded.frame} request={request} />
        )}
        {loaded.frame.kind === "matrix" && request.shape === "matrix" && (
          <MatrixView frame={loaded.frame} request={request} />
        )}
      </section>

      <aside className={`col-span-12 grid gap-3 ${sideWidth} lg:grid-rows-2`}>
        <section className="brand-hero analysis-tile relative flex min-h-36 flex-col justify-between overflow-hidden p-5">
          <div className="relative z-10">
            <p className="text-[11px] text-[var(--ink-tertiary)]">
              {highlight.focusLabel}
            </p>
            <p className="mt-3 break-words text-2xl font-semibold tracking-[-0.045em] text-[var(--ink)]">
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
  );
}
