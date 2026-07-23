"use client";

import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { useQuery } from "@tanstack/react-query";

import { useAnalysisPerformance } from "@/components/analysis/performance-context";
import { DashboardAssembly } from "@/components/dashboard-assembly";
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

import { formatCount, formatPrice } from "./formatters";
import { AnalysisEvidenceLink } from "./analysis-evidence-link";
import { InsightHeader } from "./insight-header";

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
      const height = 198;
      const scale = window.devicePixelRatio || 1;
      canvas.width = Math.round(width * scale);
      canvas.height = Math.round(height * scale);
      const context = canvas.getContext("2d");

      if (context === null) {
        return;
      }

      context.setTransform(scale, 0, 0, scale, 0, 0);
      context.fillStyle = "rgba(241, 246, 255, 0.72)";
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
          context.fillStyle = `rgba(99, 102, 241, ${0.035 + intensity * 0.76})`;
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
        context.fillStyle = "rgba(245, 196, 0, 0.18)";
        context.fillRect(day * cellWidth, top, Math.max(cellWidth, 1), bottom - top);
      }
      context.strokeStyle = "rgba(240, 111, 79, 0.92)";
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
      context.fillStyle = "rgba(226, 232, 248, 0.66)";
      context.fillRect(0, 0, selectionStart, height);
      context.fillRect(selectionEnd, 0, width - selectionEnd, height);
      context.strokeStyle = "rgba(99, 102, 241, 0.8)";
      context.lineWidth = 1.5;
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
        className="h-[198px] w-full touch-none cursor-crosshair rounded-[1.25rem] border border-white/75 shadow-inner shadow-indigo-950/5"
        onLostPointerCapture={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        ref={canvasRef}
        role="img"
      />
      <span className="pointer-events-none absolute left-3 top-3 rounded bg-white/80 px-2 py-1 text-xs tabular-nums text-[#596983]">
        {formatPrice(overflowStart)}+
      </span>
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 rounded bg-white/80 px-2 py-1 text-xs tabular-nums text-[#596983]">
        {formatPrice((request.bucketMinimum + overflowStart) / 2)}
      </span>
      <span className="pointer-events-none absolute bottom-3 left-3 rounded bg-white/80 px-2 py-1 text-xs tabular-nums text-[#596983]">
        {formatPrice(request.bucketMinimum)}
      </span>
    </div>
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
    <article className="dashboard-revealing space-y-3">
      {inactiveReason !== null && (
        <p className="rounded-xl bg-amber-50 p-4 text-sm text-amber-900" role="status">
          {inactiveReason}. This snapshot remains visible, but its local controls are inactive.
        </p>
      )}

      {localError !== null && <p className="text-sm text-destructive" role="alert">{localError}</p>}

      <p aria-live="polite" className="sr-only">
        {summary.totalCount === 0
          ? "No transactions in the selected window."
          : `${formatCount(summary.totalCount)} transactions from ${formatDate(startDate)} to ${formatDate(endDate)}.`}
      </p>

      <div className="analysis-bento">
        <section className="analysis-tile col-span-12 p-5 sm:p-7 lg:col-span-8">
          <div className="border-b border-[#09265b]/8 pb-4">
            <InsightHeader
              eyebrow="Local analytical workspace"
              explanation={plan.explanation}
              title={plan.title}
            />
          </div>
          <div className="mb-4 mt-4">
            <h3 className="text-base font-semibold text-[#09265b]">Price density through time</h3>
            <p className="mt-1 text-xs text-[#66758e]">Drag across the chart to select a window. Coral marks the estimated median.</p>
          </div>
          <DensityRiver
            endDay={endDay}
            disabled={inactiveReason !== null}
            frame={frame}
            onWindowChange={updateWindow}
            request={request}
            startDay={startDay}
          />
          <div className="mt-4 flex items-center justify-between gap-3 text-xs text-[#66758e]">
            <span>{formatDate(explorationDateAt(request, 0))}</span>
            <span>Low density — High density</span>
            <span>{formatDate(explorationDateAt(request, loaded.metadata.dayCount - 1))}</span>
          </div>
        </section>

        <aside className="col-span-12 grid gap-4 lg:col-span-4">
          <section className="analysis-tile p-5 sm:p-6">
            <p className="text-xs font-medium text-[#66758e]">Selected window</p>
            <p className="mt-2 text-lg font-semibold tabular-nums text-[#09265b]">
              {formatDate(startDate)} — {formatDate(endDate)}
            </p>
            <details className="mt-4 border-t border-[#09265b]/8 pt-3">
              <summary className="cursor-pointer text-xs font-medium text-[#1769df]">Precise date controls</summary>
              <div className="mt-4 space-y-3">
                <label className="block text-xs text-[#66758e]">
                  Start: {formatDate(startDate)}
                  <input className="mt-1 w-full accent-[#1769df]" disabled={inactiveReason !== null} max={endDay} min={0} onChange={(event) => updateWindow(Number(event.target.value), endDay)} type="range" value={startDay} />
                </label>
                <label className="block text-xs text-[#66758e]">
                  End: {formatDate(endDate)}
                  <input className="mt-1 w-full accent-[#1769df]" disabled={inactiveReason !== null} max={loaded.metadata.dayCount - 1} min={startDay} onChange={(event) => updateWindow(startDay, Number(event.target.value))} type="range" value={endDay} />
                </label>
              </div>
            </details>
          </section>

          <section className="analysis-tile p-5 sm:p-6">
            <h3 className="text-sm font-semibold text-[#09265b]">Refine locally</h3>
            <div className="mt-4 space-y-4">
              {dimensions.map((dimension, dimensionIndex) =>
                dimension.key === null ? null : (
                  <fieldset key={dimension.key}>
                    <legend className="text-xs font-medium text-[#66758e]">{dimension.label}</legend>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      <button aria-pressed={filters[dimensionIndex] === null} className="rounded-lg border border-[#09265b]/10 px-2.5 py-1.5 text-xs text-[#596983] focus-visible:outline-2 focus-visible:outline-[#1769df] aria-pressed:border-[#21c5be] aria-pressed:bg-[#21c5be]/10 aria-pressed:text-[#09265b]" disabled={inactiveReason !== null} onClick={() => updateFilter(dimensionIndex, null)} type="button">All</button>
                      {dimension.values.map((value) => (
                        <button aria-pressed={filters[dimensionIndex] === value.code} className="rounded-lg border border-[#09265b]/10 px-2.5 py-1.5 text-xs text-[#596983] focus-visible:outline-2 focus-visible:outline-[#1769df] aria-pressed:border-[#21c5be] aria-pressed:bg-[#21c5be]/10 aria-pressed:text-[#09265b]" disabled={inactiveReason !== null} key={value.code} onClick={() => updateFilter(dimensionIndex, value.code)} type="button">{value.label}</button>
                      ))}
                    </div>
                  </fieldset>
                ),
              )}
            </div>
          </section>

          <section className="grid grid-cols-2 gap-4">
            <div className="analysis-tile p-5">
              <p className="text-xs text-[#66758e]">Transactions</p>
              <p className="mt-3 text-2xl font-semibold tabular-nums text-[#09265b]">{formatCount(summary.totalCount)}</p>
            </div>
            <div className="analysis-tile p-5">
              <p className="text-xs text-[#66758e]">Average price</p>
              <p className="mt-3 text-2xl font-semibold tabular-nums text-[#09265b]">{summary.totalCount === 0 ? "—" : formatPrice(summary.averageValue)}</p>
            </div>
          </section>
        </aside>

        {summary.totalCount === 0 && (
          <p className="analysis-tile col-span-12 p-5 text-sm text-[#66758e]">No transactions match this selection.</p>
        )}

        <section className="analysis-tile col-span-12 p-5 sm:p-7 lg:col-span-7">
          <h3 className="text-sm font-semibold text-[#09265b]">Selected price distribution</h3>
          <div className="mt-4 flex h-20 items-end gap-px" aria-hidden="true">
            {Array.from(summary.histogramCounts, (count, bin) => (
              <div className="min-w-0 flex-1 bg-[#1769df]" key={bin} style={{ height: count === 0 ? "0" : `${(count / Math.max(...summary.histogramCounts, 1)) * 100}%` }} />
            ))}
          </div>
        </section>

        <section className="analysis-tile col-span-12 p-5 sm:p-7 lg:col-span-5">
          <h3 className="text-sm font-semibold text-[#09265b]">{dimensions[0].label} mix</h3>
          <div className="mt-5 space-y-4">
            {dimensions[0].values.map((value) => (
              <div key={value.code}>
                <div className="flex justify-between text-xs text-[#596983]">
                  <span>{value.label}</span>
                  <span className="tabular-nums">{formatCount(primaryCounts[value.code] ?? 0)}</span>
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[#e7eef6]">
                  <div className="h-full rounded-full bg-[#21c5be]" style={{ width: `${((primaryCounts[value.code] ?? 0) / primaryMaximum) * 100}%` }} />
                </div>
              </div>
            ))}
          </div>
          <div className="mt-6 grid grid-cols-2 gap-4 border-t border-[#09265b]/8 pt-5">
            <div><p className="text-xs text-[#66758e]">Estimated median</p><p className="mt-2 text-lg font-semibold tabular-nums text-[#09265b]">{summary.totalCount === 0 ? "—" : formatPrice(summary.median)}</p></div>
            <div><p className="text-xs text-[#66758e]">Estimated outliers</p><p className="mt-2 text-lg font-semibold tabular-nums text-[#09265b]">{summary.totalCount === 0 ? "—" : formatCount(summary.estimatedOutlierCount)}</p></div>
          </div>
        </section>

        <AnalysisEvidenceLink />

      <details className="sr-only">
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
      </div>
    </article>
  );
}

export function ExplorationAnalysis({
  plan,
  request,
}: ExplorationAnalysisProps) {
  const { failAnalysis, reportAnalysis } = useAnalysisPerformance();
  const query = useQuery({
    queryKey: ["exploration", request],
    queryFn: async ({ signal }) => loadExploration(request, signal),
    retry: false,
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: 0,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  useEffect(() => {
    if (query.data?.isOk() !== true) {
      return;
    }

    const loaded = query.data.value;
    reportAnalysis({
      title: plan.title,
      kind: "exploration",
      queryId: loaded.queryId,
      contract: "exploration/v1",
      arrowBytes: loaded.arrowBytes,
      typedRows: loaded.sourceRows,
      roundTripMs: loaded.roundTripMs,
      wasmStartupMs: loaded.wasmStartupMs,
      rustDecodeMs: loaded.rustBuildMs,
      rustComputeMs: loaded.rustQueryMs,
    });
  }, [plan.title, query.data, reportAnalysis]);

  useEffect(() => {
    if (query.isError) {
      failAnalysis("clickhouse", "The exploration request failed unexpectedly.");
      return;
    }

    if (query.data?.isErr() === true) {
      const stage = /worker|wasm|webassembly|memory/i.test(
        query.data.error.message,
      )
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
      <section className="glass-panel space-y-2 rounded-2xl p-5" role="alert">
        <p className="text-sm font-medium">The exploration workspace could not be built.</p>
        <p className="text-sm text-muted-foreground">
          An unexpected error occurred.
        </p>
      </section>
    );
  }

  if (query.data.isErr()) {
    return (
      <section className="glass-panel space-y-2 rounded-2xl p-5" role="alert">
        <p className="text-sm font-medium">The exploration workspace could not be built.</p>
        <p className="text-sm text-muted-foreground">{query.data.error.message}</p>
      </section>
    );
  }

  return <Workspace loaded={query.data.value} plan={plan} request={request} />;
}
