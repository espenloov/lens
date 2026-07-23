"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import type { AnalysisPlan } from "@/lib/analysis/contracts";
import type {
  CategoricalRequest,
  HistogramRequest,
  MatrixRequest,
} from "@/lib/analysis/execution";
import {
  loadGrammarAnalysis,
  type GrammarAnalysisRequest,
  type GrammarLoadResult,
} from "@/lib/analysis/load";
import type {
  CategoryFrame,
  HistogramFrame,
  MatrixFrame,
} from "@/lib/wasm/analysis";

import {
  formatBytes,
  formatCompactCount,
  formatCompactPrice,
  formatCount,
  formatDuration,
  formatPrice,
} from "./formatters";
import { ExecutionStory } from "./execution-story";
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
  const strongestIndex = frame.values.reduce(
    (best, value, index) => (value > frame.values[best] ? index : best),
    0,
  );
  const findingLabel =
    request.transform === "share"
      ? "Largest market share"
      : request.metric === "transaction_count"
        ? "Most transactions"
        : request.metric === "average_price"
          ? "Highest average price"
          : "Highest estimated median";

  return (
    <div>
      <div className="metric-glass mb-6 flex flex-col gap-3 rounded-2xl p-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-medium text-[#21a8a3]">
            {findingLabel}
          </p>
          <p className="mt-2 text-xl font-semibold tracking-tight text-slate-900">
            {frame.categories[strongestIndex]}
          </p>
        </div>
        <p className="font-mono text-2xl font-medium tabular-nums text-slate-800">
          {formatValue(frame.values[strongestIndex], request)}
        </p>
      </div>
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
  const strongestRow = frame.values.reduce(
    (best, value, index) => (value > frame.values[best] ? index : best),
    0,
  );
  const strongestOverflow = frame.binStarts[strongestRow] === overflowStart;
  const strongestLabel = strongestOverflow
    ? `${formatPrice(frame.binStarts[strongestRow])}+`
    : `${formatPrice(frame.binStarts[strongestRow])}–${formatPrice(frame.binEnds[strongestRow])}`;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(13rem,0.36fr)_1fr]">
      <div className="rounded-2xl bg-[#f3f7fc] p-5">
        <div>
          <p className="text-xs font-medium text-[#21a8a3]">
            Most active price band
          </p>
          <p className="mt-3 text-xl font-semibold tracking-tight text-[#09265b]">
            {strongestLabel}
          </p>
        </div>
        <p className="mt-6 text-3xl font-semibold tabular-nums text-[#09265b]">
          {formatValue(frame.values[strongestRow], request)}
        </p>
      </div>
      <div className="min-w-0">
        <div className="flex h-72 items-end gap-px border-b border-[#09265b]/10" aria-label="Price distribution histogram" role="img">
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
        <details className="mt-5 text-sm text-[#596983]">
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
  const strongestRow = frame.values.reduce(
    (best, value, index) => (value > frame.values[best] ? index : best),
    0,
  );

  return (
    <div className="space-y-4 overflow-x-auto">
      <div className="metric-glass flex min-w-80 flex-col gap-3 rounded-2xl p-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-medium text-[#21a8a3]">
            Highest intersection
          </p>
          <p className="mt-2 text-xl font-semibold tracking-tight text-slate-900">
            {frame.xLabels[frame.xIndexes[strongestRow]]} · {frame.yLabels[frame.yIndexes[strongestRow]]}
          </p>
        </div>
        <p className="font-mono text-2xl font-medium tabular-nums text-slate-800">
          {formatValue(frame.values[strongestRow], request)}
        </p>
      </div>
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

function PerformanceStrip({ loaded }: { readonly loaded: GrammarLoadResult }) {
  return (
    <ExecutionStory
      metrics={[
        { label: "Arrow payload", value: formatBytes(loaded.arrowBytes) },
        { label: "Typed contract", value: loaded.arrowContract ?? "unknown" },
        { label: "Round trip", value: formatDuration(loaded.roundTripMs) },
        { label: "Rust decode", value: `${loaded.rustDecodeMs.toFixed(2)} ms` },
      ]}
      queryId={loaded.queryId}
      summary="Trigger.dev plan · ClickHouse query · Arrow frame · Rust decode"
    />
  );
}

export function GrammarAnalysis({ plan, request }: GrammarAnalysisProps) {
  const query = useQuery({
    queryKey: ["grammar-analysis", request],
    queryFn: async () => loadGrammarAnalysis(request),
    retry: false,
  });

  if (query.isPending) {
    return (
      <section aria-live="polite" className="glass-panel-strong space-y-4 rounded-[1.75rem] p-6 sm:p-8">
        <p className="text-sm font-medium text-slate-700">Streaming a typed analysis frame…</p>
        <div className="glass-inset h-64 animate-pulse rounded-[1.4rem]" />
      </section>
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
    <article className="space-y-3">
      <div className="analysis-bento">
      <section className="analysis-tile col-span-12 p-5 sm:p-7">
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

      <PerformanceStrip loaded={loaded} />
      </div>
    </article>
  );
}
