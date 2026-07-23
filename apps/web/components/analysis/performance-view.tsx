"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  Check,
  Circle,
  Gauge,
  ShieldCheck,
  Sparkles,
  Zap,
} from "lucide-react";

import { BrandMark } from "@/components/brand-mark";
import { TechnologyMark } from "@/components/technology-mark";
import { isTerminalTriggerRun } from "@/lib/trigger/run-details";

import type { PerformanceFocus } from "./analysis-navigation";
import {
  useAnalysisPerformance,
  type AnalysisFailureStage,
  type AnalysisPerformanceReport,
  type QueryArenaEvidence,
} from "./performance-context";

function formatDuration(value: number): string {
  if (value < 1) {
    return `${value.toFixed(2)} ms`;
  }

  if (value < 1_000) {
    return `${value.toFixed(0)} ms`;
  }

  return `${(value / 1_000).toFixed(1)} s`;
}

function formatBytes(value: number): string {
  if (value < 1_024) {
    return `${value} B`;
  }

  if (value < 1_048_576) {
    return `${(value / 1_024).toFixed(1)} kB`;
  }

  return `${(value / 1_048_576).toFixed(1)} MB`;
}

type StageKey =
  | AnalysisFailureStage
  | "dashboard";

type StageState = "complete" | "failed" | "waiting";

type CanvasStage = {
  readonly key: StageKey;
  readonly label: string;
  readonly detail: string;
  readonly technology: "trigger" | "clickhouse" | "rust" | null;
  readonly state: StageState;
};

const STAGE_ORDER: readonly StageKey[] = [
  "agent",
  "clickhouse",
  "arrow",
  "rust",
  "dashboard",
];

function stageState(
  report: AnalysisPerformanceReport,
  key: StageKey,
): StageState {
  if (report.status === "completed") {
    return "complete";
  }

  const failedIndex = STAGE_ORDER.indexOf(report.failedStage ?? "agent");
  const stageIndex = STAGE_ORDER.indexOf(key);

  if (stageIndex < failedIndex) {
    return "complete";
  }

  return stageIndex === failedIndex ? "failed" : "waiting";
}

function canvasStages(report: AnalysisPerformanceReport): readonly CanvasStage[] {
  const localMs =
    report.wasmStartupMs + report.rustDecodeMs + report.rustComputeMs;

  return [
    {
      key: "agent",
      label: "Understand",
      detail: formatDuration(report.triggerMs),
      technology: "trigger",
      state: stageState(report, "agent"),
    },
    {
      key: "clickhouse",
      label: "Query data",
      detail:
        report.roundTripMs === 0 ? "Not reached" : formatDuration(report.roundTripMs),
      technology: "clickhouse",
      state: stageState(report, "clickhouse"),
    },
    {
      key: "arrow",
      label: "Transfer",
      detail: report.arrowBytes === 0 ? "Not reached" : formatBytes(report.arrowBytes),
      technology: null,
      state: stageState(report, "arrow"),
    },
    {
      key: "rust",
      label: "Shape answer",
      detail: localMs === 0 ? "Not reached" : formatDuration(localMs),
      technology: "rust",
      state: stageState(report, "rust"),
    },
    {
      key: "dashboard",
      label: "Dashboard",
      detail:
        report.status === "completed"
          ? formatDuration(report.totalMs)
          : "Not created",
      technology: null,
      state: stageState(report, "dashboard"),
    },
  ];
}

function stageDetails(
  report: AnalysisPerformanceReport,
  stage: StageKey,
): readonly { label: string; value: string }[] {
  if (stage === "agent") {
    const run = report.triggerRun;
    const status =
      run === null
        ? "Session correlated"
        : report.status === "completed" && !isTerminalTriggerRun(run)
          ? "Answer delivered · session active"
          : run.status;

    return [
      { label: "Run", value: run?.runId ?? report.triggerSessionId },
      { label: "Status", value: status },
      {
        label: "Attempts",
        value: String(run?.attemptCount ?? 1),
      },
      { label: "Worker", value: run?.version ?? "Local worker" },
    ];
  }

  if (stage === "clickhouse") {
    return [
      { label: "Query", value: report.queryId ?? "Not available" },
      { label: "Round trip", value: formatDuration(report.roundTripMs) },
      { label: "Dataset", value: report.dataset },
      { label: "Result contract", value: report.contract },
    ];
  }

  if (stage === "arrow") {
    return [
      { label: "Payload", value: formatBytes(report.arrowBytes) },
      { label: "Rows carried", value: report.typedRows.toLocaleString() },
      { label: "Contract", value: report.contract },
      { label: "Encoding", value: "Arrow IPC stream" },
    ];
  }

  if (stage === "rust") {
    return [
      { label: "Decode", value: formatDuration(report.rustDecodeMs) },
      { label: "Analysis", value: formatDuration(report.rustComputeMs) },
      { label: "WASM startup", value: formatDuration(report.wasmStartupMs) },
      {
        label: "Local total",
        value: formatDuration(
          report.rustDecodeMs +
            report.rustComputeMs +
            report.wasmStartupMs,
        ),
      },
    ];
  }

  return [
    { label: "Question → answer", value: formatDuration(report.totalMs) },
    { label: "Analysis", value: report.kind },
    { label: "Completed", value: new Date(report.completedAt).toLocaleTimeString() },
    { label: "Status", value: report.status },
  ];
}

function StageMark({ stage }: { readonly stage: CanvasStage }) {
  if (stage.technology !== null) {
    return <TechnologyMark technology={stage.technology} />;
  }

  if (stage.key === "arrow") {
    return (
      <span className="grid size-9 place-items-center rounded-xl bg-[var(--arrow)] font-mono text-[9px] font-semibold text-white">
        IPC
      </span>
    );
  }

  return <BrandMark size={36} />;
}

function StateIcon({ state }: { readonly state: StageState }) {
  if (state === "complete") {
    return <Check aria-hidden="true" className="size-3.5" />;
  }

  if (state === "failed") {
    return <AlertTriangle aria-hidden="true" className="size-3.5" />;
  }

  return <Circle aria-hidden="true" className="size-3 fill-current" />;
}

function QueryArenaSummary({
  evidence,
  focused,
}: {
  readonly evidence: QueryArenaEvidence;
  readonly focused: boolean;
}) {
  const complete = evidence.status === "completed";
  const failed = evidence.status === "failed";
  const winner =
    evidence.winner === "prewhere"
      ? "Filter pushdown"
      : evidence.winner === "baseline"
        ? "Baseline"
        : "Measuring";

  return (
    <section
      className={`analysis-tile col-span-12 overflow-hidden p-4 transition-shadow lg:col-span-5 ${
        focused ? "ring-2 ring-[#885cf6]/45 shadow-[0_20px_45px_rgb(99_71_196_/_13%)]" : ""
      }`}
    >
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="grid size-9 place-items-center rounded-xl bg-[#885cf6]/10 text-[#704bd1]">
            <Zap aria-hidden="true" className="size-4" />
          </span>
          <div>
            <p className="text-[10px] text-[var(--ink-tertiary)]">
              Optimization check
            </p>
            <p className="mt-0.5 text-sm font-semibold text-[var(--ink)]">
              {failed
                ? "The race failed safely"
                : complete
                  ? `${winner} won`
                  : "Safe strategies are racing"}
            </p>
          </div>
        </div>
        <span className="font-mono text-sm font-semibold text-[#704bd1]">
          {evidence.speedup === null
            ? `${Math.round(evidence.progress * 100)}%`
            : `${evidence.speedup.toFixed(2)}×`}
        </span>
      </div>

      <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-[#eceaf5]">
        <div
          className={`h-full rounded-full transition-[width] duration-500 ${
            failed ? "bg-[#e7808b]" : "bg-[#885cf6]"
          }`}
          style={{ width: `${Math.max(evidence.progress * 100, 4)}%` }}
        />
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2">
        <div className="analysis-tile-quiet flex items-center gap-2 p-2.5">
          <ShieldCheck
            aria-hidden="true"
            className="size-3.5 text-[#168f8a]"
          />
          <span className="text-[10px] font-medium text-[var(--ink-secondary)]">
            {evidence.verified === null
              ? "Rust verification"
              : evidence.verified
                ? "Results identical"
                : "No safe winner"}
          </span>
        </div>
        <div className="analysis-tile-quiet flex items-center gap-2 p-2.5">
          <Sparkles
            aria-hidden="true"
            className="size-3.5 text-[#b49300]"
          />
          <span className="text-[10px] font-medium text-[var(--ink-secondary)]">
            {evidence.recipeStored === null
              ? "Recipe pending"
              : evidence.recipeStored
                ? "Winner remembered"
                : "Recipe unavailable"}
          </span>
        </div>
      </div>
    </section>
  );
}

function SessionRuns({
  reports,
  selectedId,
  onSelect,
  wide,
}: {
  readonly reports: readonly AnalysisPerformanceReport[];
  readonly selectedId: string;
  readonly onSelect: (reportId: string) => void;
  readonly wide: boolean;
}) {
  const maximum = Math.max(...reports.map((report) => report.totalMs), 1);

  return (
    <section
      className={`analysis-tile col-span-12 grid min-h-28 items-center gap-4 p-4 ${
        wide
          ? "lg:grid-cols-[11rem_minmax(0,1fr)]"
          : "lg:col-span-7 lg:grid-cols-[9rem_minmax(0,1fr)]"
      }`}
    >
      <div>
        <p className="text-[10px] text-[var(--ink-tertiary)]">This session</p>
        <p className="mt-1 text-sm font-semibold text-[var(--ink)]">
          {reports.length} measured {reports.length === 1 ? "run" : "runs"}
        </p>
      </div>
      <div className="flex h-16 items-end gap-2">
        {[...reports].reverse().map((report) => (
          <button
            aria-label={`Inspect ${report.question}`}
            className={`group relative min-w-0 flex-1 rounded-t-lg transition-[height,background-color] ${
              report.status === "failed"
                ? "bg-[#e7808b]/70"
                : report.id === selectedId
                  ? "bg-[#697cc7]"
                  : "bg-[#8796d6]/42 hover:bg-[#8796d6]/75"
            }`}
            key={report.id}
            onClick={() => onSelect(report.id)}
            style={{
              height: `${Math.max((report.totalMs / maximum) * 100, 12)}%`,
            }}
            title={`${report.question}: ${formatDuration(report.totalMs)}`}
            type="button"
          >
            <span className="pointer-events-none absolute bottom-[calc(100%+6px)] left-1/2 z-20 hidden -translate-x-1/2 whitespace-nowrap rounded-lg bg-[var(--lens-dark)] px-2 py-1 text-[9px] text-white group-hover:block">
              {formatDuration(report.totalMs)}
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}

export function PerformanceView({
  focus,
}: {
  readonly focus: PerformanceFocus;
}) {
  const {
    latest,
    refreshLatestTriggerRun,
    reports,
  } = useAnalysisPerformance();
  const [selectedId, setSelectedId] = useState<string | null>(latest?.id ?? null);
  const [selectedStage, setSelectedStage] = useState<StageKey>("agent");
  const latestId = latest?.id ?? null;

  useEffect(() => {
    if (latestId !== null) {
      refreshLatestTriggerRun();
    }
  }, [latestId, refreshLatestTriggerRun]);

  const report =
    reports.find((candidate) => candidate.id === selectedId) ?? latest;
  const stages = useMemo(
    () => (report === null ? [] : canvasStages(report)),
    [report],
  );

  if (report === null) {
    return (
      <div className="view-dashboard h-full overflow-hidden">
        <section className="brand-hero analysis-tile relative mx-auto flex min-h-[28rem] w-full max-w-4xl flex-col items-center justify-center overflow-hidden p-8 text-center">
          <div className="relative z-10 flex items-center gap-3">
            <TechnologyMark technology="trigger" />
            <ArrowRight
              aria-hidden="true"
              className="size-4 text-[var(--ink-tertiary)]"
            />
            <TechnologyMark technology="clickhouse" />
            <ArrowRight
              aria-hidden="true"
              className="size-4 text-[var(--ink-tertiary)]"
            />
            <TechnologyMark technology="wasm" />
          </div>
          <h2 className="relative z-10 mt-7 text-3xl font-semibold tracking-[-0.045em] text-[var(--ink)]">
            Run a question to reveal its path.
          </h2>
          <p className="relative z-10 mt-3 max-w-md text-sm leading-6 text-[var(--ink-secondary)]">
            Every answer becomes a measured journey through the agent, data
            engine, typed stream, and local analysis.
          </p>
        </section>
      </div>
    );
  }

  const details = stageDetails(report, selectedStage);
  const failedAttempt = report.triggerRun?.attempts.find(
    (attempt) => attempt.errorMessage !== null,
  );

  return (
    <div className="view-dashboard h-full overflow-hidden">
      <div className="analysis-bento h-full">
        <section className="analysis-tile col-span-12 min-h-[24rem] overflow-hidden p-5">
          <div className="flex items-start justify-between gap-5">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <Gauge
                  aria-hidden="true"
                  className="size-3.5 text-[#697cc7]"
                />
                <p className="text-[10px] text-[var(--ink-tertiary)]">
                  Measured execution canvas
                </p>
              </div>
              <h2 className="mt-2 max-w-3xl truncate text-xl font-semibold tracking-[-0.035em] text-[var(--ink)]">
                {report.question}
              </h2>
            </div>
            <div className="shrink-0 text-right">
              <p
                className={`font-mono text-2xl font-medium tracking-[-0.05em] ${
                  report.status === "failed"
                    ? "text-[#b35461]"
                    : "text-[var(--ink)]"
                }`}
              >
                {report.status === "failed"
                  ? "Stopped"
                  : formatDuration(report.totalMs)}
              </p>
              <p className="mt-1 text-[9px] text-[var(--ink-tertiary)]">
                question → dashboard
              </p>
            </div>
          </div>

          <ol className="mt-6 grid grid-cols-5 gap-2">
            {stages.map((stage, index) => (
              <li className="relative min-w-0" key={stage.key}>
                {index < stages.length - 1 && (
                  <span
                    className={`absolute left-[calc(50%+25px)] right-[calc(-50%+25px)] top-5 h-px ${
                      stage.state === "complete"
                        ? "bg-[#93a0d6]"
                        : stage.state === "failed"
                          ? "bg-[#e7808b]"
                          : "bg-[var(--line-strong)]"
                    }`}
                  />
                )}
                <button
                  aria-pressed={selectedStage === stage.key}
                  className={`relative z-10 flex w-full min-w-0 flex-col items-center rounded-2xl border px-2 py-3 text-center transition-[background-color,border-color,transform] hover:-translate-y-0.5 ${
                    selectedStage === stage.key
                      ? "border-[#8796d6]/65 bg-white shadow-[0_14px_28px_rgb(45_57_84_/_9%)]"
                      : "border-transparent bg-white/38"
                  } ${
                    stage.state === "failed"
                      ? "border-[#e7808b]/55 bg-[#fff4f5]"
                      : stage.state === "waiting"
                        ? "opacity-45"
                        : ""
                  }`}
                  onClick={() => setSelectedStage(stage.key)}
                  type="button"
                >
                  <span className="relative">
                    <StageMark stage={stage} />
                    <span
                      className={`absolute -right-1.5 -top-1.5 grid size-5 place-items-center rounded-full border-2 border-white ${
                        stage.state === "complete"
                          ? "bg-[#21c5be] text-white"
                          : stage.state === "failed"
                            ? "bg-[#e7808b] text-white"
                            : "bg-[#e8eaf0] text-[#9aa1af]"
                      }`}
                    >
                      <StateIcon state={stage.state} />
                    </span>
                  </span>
                  <span className="mt-3 truncate text-[11px] font-semibold text-[var(--ink)]">
                    {stage.label}
                  </span>
                  <span className="mt-1 truncate font-mono text-[9px] text-[var(--ink-tertiary)]">
                    {stage.detail}
                  </span>
                </button>
              </li>
            ))}
          </ol>

          <div
            className={`mt-5 rounded-2xl border p-4 ${
              report.status === "failed" &&
              report.failedStage === selectedStage
                ? "border-[#e7808b]/45 bg-[#fff5f6]"
                : "border-[var(--line)] bg-white/42"
            }`}
          >
            {report.status === "failed" &&
              report.failedStage === selectedStage && (
                <div className="mb-4 flex items-start gap-3 border-b border-[#e7808b]/20 pb-4">
                  <AlertTriangle
                    aria-hidden="true"
                    className="mt-0.5 size-4 shrink-0 text-[#b35461]"
                  />
                  <div>
                    <p className="text-xs font-semibold text-[#923f4a]">
                      The path stopped here
                    </p>
                    <p className="mt-1 text-xs leading-5 text-[#a85a65]">
                      {failedAttempt?.errorMessage ??
                        report.errorMessage ??
                        "This stage could not complete."}
                    </p>
                  </div>
                </div>
              )}
            <dl className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              {details.map((detail) => (
                <div className="min-w-0" key={detail.label}>
                  <dt className="text-[9px] text-[var(--ink-tertiary)]">
                    {detail.label}
                  </dt>
                  <dd className="mt-1.5 truncate font-mono text-[10px] font-medium text-[var(--ink)]">
                    {detail.value}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        {report.queryArena === null ? (
          <SessionRuns
            onSelect={setSelectedId}
            reports={reports}
            selectedId={report.id}
            wide
          />
        ) : (
          <>
            <SessionRuns
              onSelect={setSelectedId}
              reports={reports}
              selectedId={report.id}
              wide={false}
            />
            <QueryArenaSummary
              evidence={report.queryArena}
              focused={focus === "arena"}
            />
          </>
        )}
      </div>
    </div>
  );
}
