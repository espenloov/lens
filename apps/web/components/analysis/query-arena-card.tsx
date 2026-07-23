"use client";

import { Check, ChevronDown, Database, Gauge, ShieldCheck, Zap } from "lucide-react";

import type {
  QueryArenaCandidate,
  QueryArenaMetadata,
  QueryStrategy,
} from "@/lib/query-arena/contracts";
import { useQueryArena } from "@/lib/query-arena/use-query-arena";
import type { TimeSeriesRequest } from "@/lib/time-series/contracts";

import { formatBytes, formatDuration } from "./formatters";

type QueryArenaCardProps = {
  readonly request: TimeSeriesRequest;
  readonly currentStrategy: QueryStrategy;
};

const STRATEGIES = ["baseline", "prewhere"] as const;

const STRATEGY_LABELS: Record<QueryStrategy, string> = {
  baseline: "Baseline scan",
  prewhere: "PREWHERE pushdown",
};

function latestEvent(
  metadata: QueryArenaMetadata | null,
  strategy: QueryStrategy,
) {
  return metadata?.candidateEvents
    ?.filter((event) => event.strategy === strategy)
    .at(-1);
}

function successfulCandidate(
  candidates: readonly QueryArenaCandidate[],
  strategy: QueryStrategy,
) {
  const candidate = candidates.find(
    (entry) => entry.strategy === strategy && entry.status !== "failed",
  );

  return candidate?.status === "failed" ? undefined : candidate;
}

export function QueryArenaCard({
  request,
  currentStrategy,
}: QueryArenaCardProps) {
  const arena = useQueryArena(request);
  const metadata = arena.snapshot?.metadata ?? null;
  const result = arena.snapshot?.result ?? null;
  const isComplete = result !== null;

  return (
    <details
      aria-label="Query Arena performance verification"
      className="group analysis-tile col-span-12 overflow-hidden"
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-4 py-3.5 marker:hidden sm:px-5">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-violet-100/70 text-violet-600">
            <Gauge aria-hidden="true" className="size-4" />
          </span>
          <div className="min-w-0">
            <h3 className="text-xs font-semibold text-slate-700">Query Arena</h3>
            <p className="truncate text-[11px] text-slate-500">
              Trigger.dev races safe plans; Rust proves the winner.
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <span className="hidden px-3 py-1 font-mono text-xs text-[#66758e] sm:block">
            {STRATEGY_LABELS[currentStrategy]}
          </span>
          <ChevronDown aria-hidden="true" className="size-4 text-slate-400 transition-transform group-open:rotate-180" />
        </div>
      </summary>

      <div className="space-y-3 border-t border-white/60 p-5" aria-live="polite">
        {STRATEGIES.map((strategy) => {
          const event = latestEvent(metadata, strategy);
          const candidate = result
            ? successfulCandidate(result.candidates, strategy)
            : undefined;
          const failed =
            result?.candidates.find(
              (entry) =>
                entry.strategy === strategy && entry.status === "failed",
            ) ?? null;
          const isWinner = result?.winner === strategy;
          const running = !isComplete && event === undefined;
          const medianMs =
            candidate?.medianMetrics.serverElapsedMs ??
            candidate?.medianMetrics.roundTripMs ??
            event?.medianMs ??
            null;

          return (
            <div
              className={`relative overflow-hidden rounded-lg border p-4 ${
                isWinner ? "border-violet-300 bg-violet-50/45" : "border-white/65 bg-white/35"
              }`}
              key={strategy}
            >
              {running && (
                <div className="absolute inset-y-0 left-0 w-1 animate-pulse bg-foreground motion-reduce:animate-none" />
              )}
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <span
                    className={`grid size-6 place-items-center rounded-full border text-xs ${
                      candidate ? "bg-foreground text-background" : ""
                    }`}
                  >
                    {candidate ? <Check className="size-3.5" /> : "·"}
                  </span>
                  <div>
                    <p className="text-sm font-medium">
                      {STRATEGY_LABELS[strategy]}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {failed
                        ? "Strategy failed safely"
                        : candidate
                          ? "3 trials · exact fingerprint"
                          : event?.status === "completed"
                            ? "Verification complete"
                            : "Running three measured trials…"}
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="font-mono text-sm">
                    {medianMs === null ? "—" : formatDuration(medianMs)}
                  </p>
                  {isWinner && (
                    <p className="text-xs font-medium">winner</p>
                  )}
                </div>
              </div>
              {candidate && (
                <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 border-t pt-3 font-mono text-xs text-muted-foreground">
                  <span>
                    {candidate.medianMetrics.rowsRead?.toLocaleString("en-GB") ??
                      "—"} rows read
                  </span>
                  <span>
                    {candidate.medianMetrics.bytesRead === null
                      ? "—"
                      : formatBytes(candidate.medianMetrics.bytesRead)} read
                  </span>
                  <span>{candidate.fingerprint.digest.slice(0, 10)}…</span>
                </div>
              )}
            </div>
          );
        })}

        {!isComplete && !arena.error && (
          <div className="space-y-2 pt-1">
            <div className="h-1 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full bg-foreground transition-[width] duration-300 motion-reduce:transition-none"
                style={{ width: `${(metadata?.progress ?? 0.05) * 100}%` }}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              {arena.isStarting
                ? "Scheduling the durable race…"
                : metadata?.phase === "verifying"
                  ? "Rust is comparing canonical Arrow results…"
                  : metadata?.phase === "persisting"
                    ? "Saving evidence and the winning recipe…"
                    : "Trigger.dev is running both strategies in parallel…"}
            </p>
          </div>
        )}

        {arena.error && !isComplete && (
          <p className="text-sm text-muted-foreground" role="status">
            The chart is ready, but its background performance audit is
            temporarily unavailable.
          </p>
        )}

        {result && (
          <div className="grid gap-3 border-t pt-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="flex gap-3">
              <Zap aria-hidden="true" className="mt-0.5 size-4" />
              <div>
                <p className="text-xs text-muted-foreground">Measured speedup</p>
                <p className="font-mono text-lg font-medium">
                  {result.speedup === null
                    ? "—"
                    : `${result.speedup.toFixed(2)}×`}
                </p>
              </div>
            </div>
            <div className="flex gap-3">
              <ShieldCheck aria-hidden="true" className="mt-0.5 size-4" />
              <div>
                <p className="text-xs text-muted-foreground">Rust proof</p>
                <p className="text-sm font-medium">
                  {result.verified ? "Results identical" : "No safe winner"}
                </p>
              </div>
            </div>
            <div className="flex gap-3">
              <Database aria-hidden="true" className="mt-0.5 size-4" />
              <div>
                <p className="text-xs text-muted-foreground">
                  ClickHouse history
                </p>
                <p className="text-sm font-medium">
                  {result.historyStored ? "Evidence stored" : "Not connected"}
                </p>
              </div>
            </div>
            <div className="flex gap-3">
              <Database aria-hidden="true" className="mt-0.5 size-4" />
              <div>
                <p className="text-xs text-muted-foreground">
                  PostgreSQL recipe
                </p>
                <p className="text-sm font-medium">
                  {result.recipeStored
                    ? "Winner activated"
                    : "Not connected"}
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    </details>
  );
}
