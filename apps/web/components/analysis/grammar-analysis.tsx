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
    <div className="space-y-3">
      {frame.categories.map((category, index) => (
        <div className="grid grid-cols-[minmax(7rem,0.7fr)_2fr_auto] items-center gap-3" key={category}>
          <span className="truncate text-sm font-medium">{category}</span>
          <div className="h-8 overflow-hidden rounded-sm bg-muted">
            <div
              className="h-full bg-foreground transition-[width] duration-500 motion-reduce:transition-none"
              style={{ width: `${Math.max(1, (frame.values[index] / maximum) * 100)}%` }}
            />
          </div>
          <span className="min-w-20 text-right font-mono text-sm tabular-nums">
            {formatValue(frame.values[index], request)}
          </span>
        </div>
      ))}
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
    <div className="space-y-2">
      {Array.from({ length: frame.values.length }, (_, row) => {
        const series = frame.seriesNames[frame.seriesIndexes[row]];
        const overflow = frame.binStarts[row] === overflowStart;
        const label = overflow
          ? `${formatPrice(frame.binStarts[row])}+`
          : `${formatPrice(frame.binStarts[row])}–${formatPrice(frame.binEnds[row])}`;

        return (
          <div className="grid grid-cols-[minmax(8rem,1fr)_2fr_auto] items-center gap-3" key={`${label}-${series}`}>
            <span className="truncate text-xs text-muted-foreground">
              {label}{frame.seriesNames.length > 1 ? ` · ${series}` : ""}
            </span>
            <div className="h-5 bg-muted">
              <div
                className="h-full bg-foreground"
                style={{ width: `${Math.max(0.5, (frame.values[row] / maximum) * 100)}%` }}
              />
            </div>
            <span className="font-mono text-xs tabular-nums">
              {formatValue(frame.values[row], request, true)}
            </span>
          </div>
        );
      })}
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
                className="grid aspect-square min-h-12 place-items-center rounded-sm border text-[11px] tabular-nums"
                key={`${xLabel}-${yLabel}`}
                style={{ backgroundColor: `color-mix(in oklab, var(--foreground) ${intensity * 88}%, var(--background))`, color: intensity > 0.55 ? "var(--background)" : "var(--foreground)" }}
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
    <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border bg-border sm:grid-cols-4">
      <div className="bg-background p-3">
        <dt className="text-xs text-muted-foreground">Arrow payload</dt>
        <dd className="mt-1 font-mono text-sm">{formatBytes(loaded.arrowBytes)}</dd>
      </div>
      <div className="bg-background p-3">
        <dt className="text-xs text-muted-foreground">Contract</dt>
        <dd className="mt-1 font-mono text-sm">{loaded.arrowContract ?? "unknown"}</dd>
      </div>
      <div className="bg-background p-3">
        <dt className="text-xs text-muted-foreground">Round trip</dt>
        <dd className="mt-1 font-mono text-sm">{formatDuration(loaded.roundTripMs)}</dd>
      </div>
      <div className="bg-background p-3">
        <dt className="text-xs text-muted-foreground">Rust decode</dt>
        <dd className="mt-1 font-mono text-sm">{loaded.rustDecodeMs.toFixed(2)} ms</dd>
      </div>
    </dl>
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
      <section aria-live="polite" className="space-y-3 border-y py-8">
        <p className="text-sm font-medium">Streaming a typed analysis frame…</p>
        <div className="h-64 animate-pulse rounded-lg bg-muted" />
      </section>
    );
  }

  if (query.isError || query.data.isErr()) {
    return (
      <p className="border-y py-5 text-sm text-destructive" role="alert">
        The analysis frame could not be loaded.
      </p>
    );
  }

  const loaded = query.data.value;

  if (loaded.frame.values.length === 0) {
    return (
      <section className="space-y-2 border-y py-6">
        <h2 className="text-xl font-medium">{plan.title}</h2>
        <p className="text-sm text-muted-foreground">
          No transactions matched this analysis.
        </p>
      </section>
    );
  }

  return (
    <article className="space-y-6">
      <header className="space-y-2">
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {plan.operation}
        </p>
        <h2 className="text-2xl font-medium tracking-tight">{plan.title}</h2>
        <p className="max-w-3xl text-sm text-muted-foreground">{plan.explanation}</p>
      </header>

      <section className="rounded-xl border p-5">
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
    </article>
  );
}
