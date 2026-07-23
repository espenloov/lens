"use client";

import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Zap } from "lucide-react";

import { DashboardAssembly } from "@/components/dashboard-assembly";
import { AnalysisEvidenceLink } from "@/components/analysis/analysis-evidence-link";
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

import { QueryArenaReporter } from "./query-arena-reporter";

type SemanticAnalysisResultProps = {
  readonly output: SemanticAnalysisToolOutput;
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
}: {
  readonly items: readonly SemanticCategoryItem[];
  readonly model: SemanticVisualModel;
}) {
  const visible = items.slice(0, 8);
  const maximum = Math.max(...visible.map((item) => Math.abs(item.value)), 1);

  return (
    <div className="space-y-3">
      {visible.map((item, index) => (
        <div
          className="grid grid-cols-[minmax(6rem,0.75fr)_2fr_auto] items-center gap-3"
          key={item.label}
        >
          <span className="truncate text-xs font-medium text-[var(--ink-secondary)]">
            {item.label}
          </span>
          <div className="h-8 overflow-hidden rounded-lg bg-[#eef1f6]">
            <div
              className="h-full rounded-lg transition-[width] duration-700 motion-reduce:transition-none"
              style={{
                background: SERIES_COLOURS[index % SERIES_COLOURS.length],
                opacity: 1 - index * 0.06,
                width: `${(Math.abs(item.value) / maximum) * 100}%`,
              }}
            />
          </div>
          <span className="min-w-20 text-right font-mono text-xs tabular-nums text-[var(--ink)]">
            {formatSemanticValue(item.value, model.valueFormat)}
          </span>
        </div>
      ))}
    </div>
  );
}

function SeriesChart({
  highlighted = new Set<string>(),
  interval,
  model,
  points,
}: {
  readonly highlighted?: ReadonlySet<string>;
  readonly interval: "year" | "quarter" | "month";
  readonly model: SemanticVisualModel;
  readonly points: readonly SemanticSeriesPoint[];
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
          <linearGradient id="semantic-area" x1="0" x2="0" y1="0" y2="1">
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
              {area !== null && <path d={area} fill="url(#semantic-area)" />}
              <path
                d={path}
                fill="none"
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
                    cx={x(point.periodStart)}
                    cy={y(point.value)}
                    fill={isHighlighted ? "#ef9ca5" : "white"}
                    key={point.periodStart}
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
      <div className="mt-1 flex items-center justify-between text-[10px] text-[var(--ink-tertiary)]">
        <span>{periods[0] === undefined ? "" : formatPeriod(periods[0], interval)}</span>
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
}: {
  readonly model: Extract<SemanticVisualModel, { kind: "distribution" }>;
}) {
  const maximum = Math.max(...model.bins.map((bin) => Math.abs(bin.value)), 1);

  return (
    <div className="flex h-[14rem] items-end gap-1 border-b border-[var(--line)]">
      {model.bins.map((bin, index) => (
        <div
          className="min-w-0 flex-1 rounded-t-[0.35rem] bg-[#8796d6] transition-[height] duration-700 motion-reduce:transition-none"
          key={`${bin.start}-${bin.end}-${bin.seriesIndex}-${index}`}
          style={{
            height: `${Math.max((Math.abs(bin.value) / maximum) * 100, 2)}%`,
            opacity: 0.45 + (index / Math.max(model.bins.length, 1)) * 0.5,
          }}
          title={`${formatSemanticValue(bin.start, model.measureFormat)}–${formatSemanticValue(bin.end, model.measureFormat)}: ${formatSemanticValue(bin.value, model.valueFormat)}`}
        />
      ))}
    </div>
  );
}

function AnomalyChart({
  model,
}: {
  readonly model: Extract<SemanticVisualModel, { kind: "anomaly" }>;
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
        points={points}
      />
      <div className="absolute right-0 top-0 flex items-center gap-2 rounded-full bg-[#ef9ca5]/14 px-3 py-1.5 text-[10px] font-semibold text-[#9b4c58]">
        <span className="size-1.5 rounded-full bg-[#ef9ca5]" />
        {model.points.filter((point) => point.flagged).length} findings
      </div>
    </div>
  );
}

function MainVisual({ model }: { readonly model: SemanticVisualModel }) {
  switch (model.kind) {
    case "trend":
      return (
        <SeriesChart interval={model.interval} model={model} points={model.points} />
      );
    case "comparison":
    case "composition":
      return model.layout === "categorical" ? (
        <CategoryChart items={model.items} model={model} />
      ) : (
        <SeriesChart
          interval={model.interval!}
          model={model}
          points={model.points}
        />
      );
    case "ranking":
      return <CategoryChart items={model.items} model={model} />;
    case "distribution":
      return <DistributionChart model={model} />;
    case "anomaly":
      return <AnomalyChart model={model} />;
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
  const focus = primaryValue(model);
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
    <article
      className="analysis-bento content-start dashboard-revealing"
      data-dashboard-kind={model.kind}
    >
      <section
        aria-label={model.title}
        className={`analysis-tile col-span-12 min-h-[22rem] p-6 ${mainWidth}`}
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
          <span className="rounded-full bg-[#8796d6]/10 px-3 py-1.5 text-[10px] font-semibold text-[#5c6db0]">
            Interactive
          </span>
        </header>
        <MainVisual model={model} />
      </section>

      <aside className={`col-span-12 grid gap-3 ${sideWidth} lg:grid-rows-2`}>
        <section className="brand-hero analysis-tile relative flex min-h-36 flex-col justify-between overflow-hidden p-5">
          <div className="relative z-10">
            <p className="text-[11px] text-[var(--ink-tertiary)]">{focus.detail}</p>
            <p className="mt-3 break-words text-2xl font-semibold tracking-[-0.045em] text-[var(--ink)]">
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
                {model.explanation}
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
  );
}

export function SemanticAnalysisResult({
  output,
}: SemanticAnalysisResultProps) {
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

  return <ReadySemanticAnalysis output={output} />;
}

function ReadySemanticAnalysis({
  output,
}: {
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
  const arenaRequest = queryArenaSemanticRequestSchema.safeParse(
    output.request,
  );

  return (
    <>
      {loaded.queryId !== null && arenaRequest.success && (
        <QueryArenaReporter
          analysis={{ kind: "semantic", request: arenaRequest.data }}
          currentStrategy={loaded.strategy}
          queryId={loaded.queryId}
        />
      )}
      <SemanticVisualResult loaded={loaded} />
    </>
  );
}
