"use client";

import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { useQuery } from "@tanstack/react-query";

import type { AnalysisPlan } from "@/lib/analysis/contracts";
import {
  explorationDateAt,
  explorationDimensions,
} from "@/lib/analysis/exploration-adapter";
import {
  loadExploration,
  type ExplorationLoadResult,
} from "@/lib/analysis/exploration-load";
import type { ExplorationRequest } from "@/lib/analysis/execution";
import type {
  ExplorationFilters,
  ExplorationFrame,
} from "@/lib/wasm/exploration-types";

import {
  formatBytes,
  formatCount,
  formatDuration,
  formatPrice,
} from "./formatters";

type ExplorationAnalysisProps = {
  readonly plan: AnalysisPlan;
  readonly request: ExplorationRequest;
};

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

function DensityRiver({
  frame,
  request,
  startDay,
  endDay,
  disabled,
  onWindowChange,
}: {
  readonly frame: ExplorationFrame;
  readonly request: ExplorationRequest;
  readonly startDay: number;
  readonly endDay: number;
  readonly disabled: boolean;
  readonly onWindowChange: (start: number, end: number) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragAnchor = useRef<number | null>(null);
  const pendingWindow = useRef<readonly [number, number] | null>(null);
  const pointerFrame = useRef<number | null>(null);
  const dayCount = frame.dailyQuartiles.length / 3;
  const binCount = frame.densityCounts.length / dayCount;

  useEffect(() => {
    const canvas = canvasRef.current;

    if (canvas === null) {
      return;
    }

    const draw = () => {
      const width = Math.max(canvas.clientWidth, 320);
      const height = 340;
      const scale = window.devicePixelRatio || 1;
      canvas.width = Math.round(width * scale);
      canvas.height = Math.round(height * scale);
      const context = canvas.getContext("2d");

      if (context === null) {
        return;
      }

      context.setTransform(scale, 0, 0, scale, 0, 0);
      context.fillStyle = "#07111f";
      context.fillRect(0, 0, width, height);
      const maximum = Math.max(...frame.densityCounts, 1);
      const cellWidth = width / dayCount;
      const cellHeight = height / binCount;

      for (let day = 0; day < dayCount; day += 1) {
        for (let bin = 0; bin < binCount; bin += 1) {
          const count = frame.densityCounts[day * binCount + bin];

          if (count === 0) {
            continue;
          }

          const intensity = Math.log1p(count) / Math.log1p(maximum);
          context.fillStyle = `rgba(34, 211, 238, ${0.06 + intensity * 0.9})`;
          context.fillRect(
            day * cellWidth,
            height - (bin + 1) * cellHeight,
            Math.max(cellWidth + 0.5, 1),
            Math.max(cellHeight + 0.5, 1),
          );
        }
      }

      const valueToY = (value: number) => {
        const bin = (value - request.bucketMinimum) / request.bucketWidth;
        return height - Math.min(Math.max(bin, 0), binCount) * cellHeight;
      };

      for (let day = 0; day < dayCount; day += 1) {
        const q1 = frame.dailyQuartiles[day * 3];
        const q3 = frame.dailyQuartiles[day * 3 + 2];

        if (!Number.isFinite(q1) || !Number.isFinite(q3)) {
          continue;
        }

        const top = valueToY(q3);
        const bottom = valueToY(q1);
        context.fillStyle = "rgba(251, 113, 133, 0.16)";
        context.fillRect(day * cellWidth, top, Math.max(cellWidth, 1), bottom - top);
      }
      context.strokeStyle = "rgba(251, 113, 133, 0.9)";
      context.lineWidth = 2;
      context.beginPath();
      let medianStarted = false;

      for (let day = 0; day < dayCount; day += 1) {
        const median = frame.dailyQuartiles[day * 3 + 1];

        if (!Number.isFinite(median)) {
          medianStarted = false;
          continue;
        }

        const x = (day + 0.5) * cellWidth;
        const y = valueToY(median);

        if (!medianStarted) {
          context.moveTo(x, y);
          medianStarted = true;
        } else {
          context.lineTo(x, y);
        }
      }

      context.stroke();
      const selectionStart = (startDay / dayCount) * width;
      const selectionEnd = ((endDay + 1) / dayCount) * width;
      context.fillStyle = "rgba(2, 6, 23, 0.62)";
      context.fillRect(0, 0, selectionStart, height);
      context.fillRect(selectionEnd, 0, width - selectionEnd, height);
      context.strokeStyle = "rgba(255, 255, 255, 0.85)";
      context.lineWidth = 1;
      context.strokeRect(selectionStart, 0.5, selectionEnd - selectionStart, height - 1);
    };

    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(canvas);

    return () => observer.disconnect();
  }, [binCount, dayCount, endDay, frame, request, startDay]);

  useEffect(
    () => () => {
      if (pointerFrame.current !== null) {
        cancelAnimationFrame(pointerFrame.current);
      }
    },
    [],
  );

  function dayAtPointer(event: ReactPointerEvent<HTMLCanvasElement>): number {
    const bounds = event.currentTarget.getBoundingClientRect();
    const position = Math.min(Math.max(event.clientX - bounds.left, 0), bounds.width);

    return Math.min(dayCount - 1, Math.floor((position / bounds.width) * dayCount));
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (disabled) {
      return;
    }

    const day = dayAtPointer(event);
    dragAnchor.current = day;
    event.currentTarget.setPointerCapture(event.pointerId);
    onWindowChange(day, day);
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (disabled || dragAnchor.current === null) {
      return;
    }

    const day = dayAtPointer(event);
    pendingWindow.current = [
      Math.min(dragAnchor.current, day),
      Math.max(dragAnchor.current, day),
    ];

    if (pointerFrame.current === null) {
      pointerFrame.current = requestAnimationFrame(() => {
        pointerFrame.current = null;
        const pending = pendingWindow.current;

        if (pending !== null) {
          onWindowChange(pending[0], pending[1]);
        }
      });
    }
  }

  function handlePointerUp() {
    dragAnchor.current = null;
    pendingWindow.current = null;
  }

  const overflowStart =
    request.bucketMinimum + request.bucketWidth * (request.binCount - 1);

  return (
    <div className="relative">
      <canvas
        aria-label={`Transaction density by day and ${formatPrice(request.bucketWidth)} value band. The coral ribbon is the estimated interquartile range and the line is the estimated daily median. Use the range controls below to select dates.`}
        className="h-[340px] w-full touch-none cursor-crosshair rounded-xl border"
        onLostPointerCapture={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        ref={canvasRef}
        role="img"
      />
      <span className="pointer-events-none absolute left-2 top-2 rounded bg-slate-950/70 px-1.5 py-0.5 font-mono text-[10px] text-slate-200">
        {formatPrice(overflowStart)}+
      </span>
      <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 rounded bg-slate-950/70 px-1.5 py-0.5 font-mono text-[10px] text-slate-200">
        {formatPrice((request.bucketMinimum + overflowStart) / 2)}
      </span>
      <span className="pointer-events-none absolute bottom-2 left-2 rounded bg-slate-950/70 px-1.5 py-0.5 font-mono text-[10px] text-slate-200">
        {formatPrice(request.bucketMinimum)}
      </span>
    </div>
  );
}

function PerformanceEvidence({
  loaded,
  localUpdates,
  localQueryMs,
}: {
  readonly loaded: ExplorationLoadResult;
  readonly localUpdates: number;
  readonly localQueryMs: number;
}) {
  const metrics = [
    ["Typed transactions", formatCount(loaded.sourceRows)],
    ["Arrow payload", formatBytes(loaded.arrowBytes)],
    ["Round trip", formatDuration(loaded.roundTripMs)],
    ["Rust index build", `${loaded.rustBuildMs.toFixed(1)} ms`],
    ["Local Rust update", `${localQueryMs.toFixed(2)} ms`],
    ["Local index", formatBytes(loaded.metadata.indexBytes)],
    ["Local updates", formatCount(localUpdates)],
    [
      "Exploration requests after load",
      String(Math.max(loaded.analysisApiRequests - 1, 0)),
    ],
  ] as const;

  return (
    <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border bg-border md:grid-cols-4">
      {metrics.map(([label, value]) => (
        <div className="bg-background p-3" key={label}>
          <dt className="text-xs text-muted-foreground">{label}</dt>
          <dd className="mt-1 font-mono text-sm tabular-nums">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function Workspace({
  loaded,
  plan,
  request,
}: {
  readonly loaded: ExplorationLoadResult;
  readonly plan: AnalysisPlan;
  readonly request: ExplorationRequest;
}) {
  const dimensions = explorationDimensions(request);
  const [startDay, setStartDay] = useState(0);
  const [endDay, setEndDay] = useState(loaded.metadata.dayCount - 1);
  const [filters, setFilters] = useState<ExplorationFilters>([null, null, null]);
  const [frame, setFrame] = useState(loaded.frame);
  const [summary, setSummary] = useState(loaded.summary);
  const [localQueryMs, setLocalQueryMs] = useState(loaded.rustQueryMs);
  const [localUpdates, setLocalUpdates] = useState(0);
  const [localError, setLocalError] = useState<string | null>(null);
  const sequence = useRef(0);
  const frameFilters = useRef<ExplorationFilters>([null, null, null]);

  const [inactiveReason, setInactiveReason] = useState<string | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    loaded.client.retain();
    const unsubscribe = loaded.client.onDisposed(setInactiveReason);

    return () => {
      mounted.current = false;
      unsubscribe();
      sequence.current += 1;
      loaded.client.release();
    };
  }, [loaded.client]);

  function runLocalQuery(
    nextStart: number,
    nextEnd: number,
    nextFilters: ExplorationFilters,
    includeDensity: boolean,
  ) {
    sequence.current += 1;
    const requestSequence = sequence.current;
    const frameIsStale = nextFilters.some(
      (filter, index) => filter !== frameFilters.current[index],
    );
    setLocalError(null);
    void loaded.client
      .query({
        startDay: nextStart,
        endDay: nextEnd,
        filters: nextFilters,
        includeDensity: includeDensity || frameIsStale,
      })
      .then((result) => {
        if (!mounted.current || requestSequence !== sequence.current) {
          return;
        }

        setSummary(result.summary);
        setLocalQueryMs(result.rustQueryMs);
        setLocalUpdates((count) => count + 1);

        if (result.frame !== null) {
          setFrame(result.frame);
          frameFilters.current = nextFilters;
        }
      })
      .catch((cause: unknown) => {
        if (mounted.current && requestSequence === sequence.current) {
          setLocalError(cause instanceof Error ? cause.message : String(cause));
        }
      });
  }

  function updateWindow(nextStart: number, nextEnd: number) {
    const boundedStart = Math.min(nextStart, nextEnd);
    const boundedEnd = Math.max(nextStart, nextEnd);
    setStartDay(boundedStart);
    setEndDay(boundedEnd);
    runLocalQuery(boundedStart, boundedEnd, filters, false);
  }

  function updateFilter(dimension: number, code: number | null) {
    const next: ExplorationFilters = [
      dimension === 0 ? code : filters[0],
      dimension === 1 ? code : filters[1],
      dimension === 2 ? code : filters[2],
    ];
    setFilters(next);
    runLocalQuery(startDay, endDay, next, true);
  }

  const startDate = explorationDateAt(request, startDay);
  const endDate = explorationDateAt(request, endDay);
  const primaryCounts = summary.dimensionCounts[0];
  const primaryMaximum = Math.max(...primaryCounts, 1);

  return (
    <article className="space-y-6">
      <header className="space-y-2">
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-cyan-500">
          Local analytical workspace
        </p>
        <h2 className="text-2xl font-medium tracking-tight">{plan.title}</h2>
        <p className="max-w-3xl text-sm text-muted-foreground">{plan.explanation}</p>
      </header>

      <section className="space-y-4 rounded-2xl border bg-card p-4 sm:p-6">
        {inactiveReason !== null && (
          <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm" role="status">
            {inactiveReason}. This snapshot remains visible, but its local controls are inactive.
          </p>
        )}
        <fieldset className="contents" disabled={inactiveReason !== null}>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-sm font-medium">Value-density river</p>
            <p className="text-xs text-muted-foreground">
              One cell per day and price band · coral shows estimated median
            </p>
          </div>
          <p className="font-mono text-sm tabular-nums">
            {formatDate(startDate)} — {formatDate(endDate)}
          </p>
        </div>

        <DensityRiver
          endDay={endDay}
          disabled={inactiveReason !== null}
          frame={frame}
          onWindowChange={updateWindow}
          request={request}
          startDay={startDay}
        />

        <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
          <span>{formatDate(explorationDateAt(request, 0))}</span>
          <span className="flex items-center gap-2">
            Lower density
            <span className="h-2 w-24 rounded-full bg-gradient-to-r from-cyan-950 via-cyan-600 to-cyan-200" />
            Higher density
          </span>
          <span>{formatDate(explorationDateAt(request, loaded.metadata.dayCount - 1))}</span>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-1 text-xs text-muted-foreground">
            Start: {formatDate(startDate)}
            <input
              className="w-full accent-cyan-500"
              max={endDay}
              min={0}
              onChange={(event) => updateWindow(Number(event.target.value), endDay)}
              type="range"
              value={startDay}
            />
          </label>
          <label className="space-y-1 text-xs text-muted-foreground">
            End: {formatDate(endDate)}
            <input
              className="w-full accent-cyan-500"
              max={loaded.metadata.dayCount - 1}
              min={startDay}
              onChange={(event) => updateWindow(startDay, Number(event.target.value))}
              type="range"
              value={endDay}
            />
          </label>
        </div>

        <div className="space-y-3">
          {dimensions.map((dimension, dimensionIndex) =>
            dimension.key === null ? null : (
              <fieldset className="flex flex-wrap items-center gap-2" key={dimension.key}>
                <legend className="mr-2 text-xs font-medium text-muted-foreground">
                  {dimension.label}
                </legend>
                <button
                  aria-pressed={filters[dimensionIndex] === null}
                  className="rounded-full border px-3 py-1 text-xs aria-pressed:bg-foreground aria-pressed:text-background"
                  onClick={() => updateFilter(dimensionIndex, null)}
                  type="button"
                >
                  All
                </button>
                {dimension.values.map((value) => (
                  <button
                    aria-pressed={filters[dimensionIndex] === value.code}
                    className="rounded-full border px-3 py-1 text-xs aria-pressed:bg-foreground aria-pressed:text-background"
                    key={value.code}
                    onClick={() => updateFilter(dimensionIndex, value.code)}
                    type="button"
                  >
                    {value.label}
                  </button>
                ))}
              </fieldset>
            ),
          )}
        </div>
        </fieldset>
      </section>

      {localError !== null && <p className="text-sm text-destructive" role="alert">{localError}</p>}

      <p aria-live="polite" className="sr-only">
        {summary.totalCount === 0
          ? "No transactions in the selected window."
          : `${formatCount(summary.totalCount)} transactions from ${formatDate(startDate)} to ${formatDate(endDate)}.`}
      </p>

      {summary.totalCount === 0 && (
        <p className="rounded-xl border p-4 text-sm text-muted-foreground">
          No transactions match this time window and category selection.
        </p>
      )}

      <section className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {[
          ["Transactions", formatCount(summary.totalCount)],
          ["Average", summary.totalCount === 0 ? "—" : formatPrice(summary.averageValue)],
          ["Estimated P25", summary.totalCount === 0 ? "—" : formatPrice(summary.q1)],
          ["Estimated median", summary.totalCount === 0 ? "—" : formatPrice(summary.median)],
          ["Estimated P75", summary.totalCount === 0 ? "—" : formatPrice(summary.q3)],
          ["Estimated outliers", summary.totalCount === 0 ? "—" : formatCount(summary.estimatedOutlierCount)],
        ].map(([label, value]) => (
          <div className="rounded-xl border p-3" key={label}>
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className="mt-1 font-mono text-sm tabular-nums">{value}</p>
          </div>
        ))}
      </section>

      <section className="grid gap-6 rounded-xl border p-5 lg:grid-cols-[2fr_1fr]">
        <div>
          <h3 className="text-sm font-medium">Selected price distribution</h3>
          <div className="mt-4 flex h-36 items-end gap-px" aria-hidden="true">
            {Array.from(summary.histogramCounts, (count, bin) => (
              <div
                className="min-w-0 flex-1 bg-cyan-500/80"
                key={bin}
                style={{
                  height: count === 0 ? "0" : `${(count / Math.max(...summary.histogramCounts, 1)) * 100}%`,
                }}
              />
            ))}
          </div>
        </div>
        <div>
          <h3 className="text-sm font-medium">{dimensions[0].label} mix</h3>
          <div className="mt-4 space-y-3">
            {dimensions[0].values.map((value) => (
              <div className="space-y-1" key={value.code}>
                <div className="flex justify-between text-xs">
                  <span>{value.label}</span>
                  <span className="font-mono">{formatCount(primaryCounts[value.code] ?? 0)}</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full bg-rose-400"
                    style={{ width: `${((primaryCounts[value.code] ?? 0) / primaryMaximum) * 100}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <PerformanceEvidence
        loaded={loaded}
        localQueryMs={localQueryMs}
        localUpdates={localUpdates}
      />

      <details className="rounded-xl border p-4">
        <summary className="cursor-pointer text-sm font-medium">Accessible selected-window data</summary>
        <table className="mt-4 w-full text-left text-sm">
          <thead>
            <tr className="border-b">
              <th className="py-2">Price band</th>
              <th className="py-2 text-right">Transactions</th>
            </tr>
          </thead>
          <tbody>
            {Array.from(summary.histogramCounts, (count, bin) => (
              <tr className="border-b" key={bin}>
                <td className="py-2">
                  {formatPrice(request.bucketMinimum + bin * request.bucketWidth)}
                  {bin === request.binCount - 1 ? "+" : ""}
                </td>
                <td className="py-2 text-right font-mono">{formatCount(count)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </article>
  );
}

export function ExplorationAnalysis({
  plan,
  request,
}: ExplorationAnalysisProps) {
  const query = useQuery({
    queryKey: ["exploration", request],
    queryFn: async ({ signal }) => loadExploration(request, signal),
    retry: false,
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: 0,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  if (query.isPending) {
    return (
      <section aria-live="polite" className="space-y-3 border-y py-8">
        <p className="text-sm font-medium">Building a local Rust workspace from Arrow…</p>
        <div className="h-80 animate-pulse rounded-xl bg-muted" />
      </section>
    );
  }

  if (query.isError) {
    return (
      <section className="space-y-2 border-y py-5" role="alert">
        <p className="text-sm font-medium">The exploration workspace could not be built.</p>
        <p className="text-sm text-muted-foreground">
          An unexpected error occurred.
        </p>
      </section>
    );
  }

  if (query.data.isErr()) {
    return (
      <section className="space-y-2 border-y py-5" role="alert">
        <p className="text-sm font-medium">The exploration workspace could not be built.</p>
        <p className="text-sm text-muted-foreground">{query.data.error.message}</p>
      </section>
    );
  }

  return <Workspace loaded={query.data.value} plan={plan} request={request} />;
}
