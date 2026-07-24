"use client";

import {
  ArrowRight,
  Check,
  Circle,
  DatabaseZap,
  ShieldCheck,
  Sparkles,
  Trophy,
  X,
  Zap,
} from "lucide-react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { TechnologyMark } from "@/components/technology-mark";
import { TuningProposalCard } from "@/components/query-arena/tuning-proposal-card";
import type { TuningProposal } from "@/lib/query-arena/tuning/contracts";

import type {
  AnalysisPerformanceReport,
  QueryArenaEvidence,
} from "./performance-context";
import {
  buildArenaLanes,
  summarizeSystemIntelligence,
  type ArenaTrialModel,
} from "./query-arena-presentation";
import { loadSystemIntelligence } from "./system-intelligence-client";
import {
  createTuningProposal,
  decideTuningProposal,
} from "./tuning-client";

function formatDuration(value: number): string {
  if (value < 1) {
    return `${value.toFixed(2)} ms`;
  }

  if (value < 1_000) {
    return `${value.toFixed(0)} ms`;
  }

  return `${(value / 1_000).toFixed(1)} s`;
}

function phaseLabel(evidence: QueryArenaEvidence): string {
  if (evidence.status === "failed") {
    return "The race stopped safely";
  }

  if (evidence.phase === "verifying") {
    return "Proving both answers match";
  }

  if (evidence.phase === "persisting") {
    return "Remembering the faster path";
  }

  if (evidence.status === "completed") {
    if (evidence.learningSource === "exact") {
      return "A proven path was reused";
    }

    return evidence.recipeStored === true
      ? "A faster path was learned"
      : "The safest path was measured";
  }

  return evidence.status === "queued"
    ? "Preparing a fair race"
    : "Three measured passes per path";
}

function Trial({ trial }: { readonly trial: ArenaTrialModel }) {
  const label =
    trial.durationMs === null
      ? trial.state === "running"
        ? "Measuring"
        : trial.state === "failed"
          ? "Stopped"
          : trial.state === "complete"
            ? "Measured"
            : "Waiting"
      : formatDuration(trial.durationMs);

  return (
    <div className="relative flex min-w-0 flex-1 flex-col items-center">
      <span
        aria-label={`Pass ${trial.index + 1}: ${label}`}
        className={`relative z-10 grid size-6 place-items-center rounded-full border text-[8px] font-semibold transition-all ${
          trial.state === "complete"
            ? "border-[#21c5be] bg-[#e9fbf9] text-[#137c78]"
            : trial.state === "failed"
              ? "border-[#e7808b] bg-[#fff1f3] text-[#a34b56]"
              : trial.state === "running"
                ? "animate-pulse border-[#885cf6] bg-[#f2edff] text-[#704bd1] shadow-[0_0_0_5px_rgb(136_92_246_/_8%)]"
                : "border-[#d9dce7] bg-white/75 text-[#9aa1af]"
        }`}
      >
        {trial.state === "complete" ? (
          <Check aria-hidden="true" className="size-3" />
        ) : trial.state === "failed" ? (
          <Circle aria-hidden="true" className="size-2 fill-current" />
        ) : (
          trial.index + 1
        )}
      </span>
      <span className="mt-1.5 truncate font-mono text-[8px] text-[var(--ink-tertiary)]">
        {trial.durationMs === null ? `pass ${trial.index + 1}` : label}
      </span>
    </div>
  );
}

export function QueryArenaExperience({
  evidence,
  focused,
}: {
  readonly evidence: QueryArenaEvidence;
  readonly focused: boolean;
}) {
  const lanes = buildArenaLanes(evidence);
  const complete = evidence.status === "completed";
  const verified = evidence.verified === true;

  return (
    <section
      className={`analysis-tile col-span-12 overflow-hidden p-4 transition-shadow lg:col-span-8 ${
        focused
          ? "ring-2 ring-[#885cf6]/45 shadow-[0_20px_45px_rgb(99_71_196_/_13%)]"
          : ""
      }`}
    >
      <div className="flex items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-[#885cf6]/10 text-[#704bd1]">
            <Zap aria-hidden="true" className="size-4" />
          </span>
          <div className="min-w-0">
            <p className="text-[9px] text-[var(--ink-tertiary)]">
              Query Arena · live
            </p>
            <p className="mt-0.5 truncate text-sm font-semibold text-[var(--ink)]">
              {phaseLabel(evidence)}
            </p>
            {evidence.learningSource === "prior" && (
              <p className="mt-0.5 truncate text-[8px] font-medium text-[#704bd1]">
                Familiar pattern · {evidence.priorEvidenceCount} learned{" "}
                {evidence.priorEvidenceCount === 1 ? "path" : "paths"} guide
                the race
              </p>
            )}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <p className="font-mono text-sm font-semibold text-[#704bd1]">
            {evidence.speedup === null
              ? `${Math.round(evidence.progress * 100)}%`
              : `${evidence.speedup.toFixed(2)}×`}
          </p>
          <p className="mt-0.5 text-[8px] text-[var(--ink-tertiary)]">
            {evidence.speedup === null ? "race progress" : "faster"}
          </p>
        </div>
      </div>

      <div className="mt-3 grid gap-2">
        {lanes.map((lane) => (
          <div
            className={`grid min-w-0 grid-cols-[6.5rem_minmax(0,1fr)_4rem] items-center gap-3 rounded-2xl border px-3 py-2 transition-all ${
              lane.winner
                ? "border-[#21c5be]/45 bg-[#effbf9]/72 shadow-[inset_3px_0_0_#21c5be]"
                : lane.state === "failed"
                  ? "border-[#e7808b]/35 bg-[#fff6f7]"
                  : "border-[var(--line)] bg-white/42"
            }`}
            key={lane.strategy}
          >
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                {lane.winner && (
                  <Trophy
                    aria-hidden="true"
                    className="size-3 shrink-0 text-[#168f8a]"
                  />
                )}
                <p className="truncate text-[10px] font-semibold text-[var(--ink)]">
                  {lane.label}
                </p>
              </div>
              <p className="mt-0.5 truncate text-[8px] text-[var(--ink-tertiary)]">
                {lane.current ? "Current path" : "Challenger"}
              </p>
            </div>

            <div className="relative flex min-w-0 items-start">
              <span className="absolute left-[16%] right-[16%] top-3 h-px bg-[#dfe1ea]" />
              {lane.trials.map((trial) => (
                <Trial key={trial.index} trial={trial} />
              ))}
            </div>

            <div className="text-right">
              <p className="font-mono text-[10px] font-semibold text-[var(--ink)]">
                {lane.medianMs === null
                  ? lane.state === "failed"
                    ? "Stopped"
                    : "—"
                  : formatDuration(lane.medianMs)}
              </p>
              <p className="mt-0.5 text-[8px] text-[var(--ink-tertiary)]">
                middle pass
              </p>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-3 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3 rounded-2xl border border-[var(--line)] bg-white/38 px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <TechnologyMark className="size-7 rounded-lg" technology="rust" />
          <div className="min-w-0">
            <p className="truncate text-[9px] font-semibold text-[var(--ink)]">
              {evidence.verified === null
                ? "Proof checkpoint"
                : verified
                  ? "Answers match"
                  : "No safe winner"}
            </p>
            <p className="truncate text-[8px] text-[var(--ink-tertiary)]">
              Rust compares every result
            </p>
          </div>
          {verified && (
            <ShieldCheck
              aria-hidden="true"
              className="ml-auto size-3.5 shrink-0 text-[#168f8a]"
            />
          )}
        </div>

        <ArrowRight
          aria-hidden="true"
          className={`size-3.5 ${
            verified ? "text-[#21c5be]" : "text-[#c3c7d3]"
          }`}
        />

        <div className="flex min-w-0 items-center gap-2">
          <TechnologyMark className="size-7 rounded-lg" technology="postgres" />
          <div className="min-w-0">
            <p className="truncate text-[9px] font-semibold text-[var(--ink)]">
              {evidence.recipeStored === null
                ? "Learning waits"
                : evidence.recipeStored
                  ? "Winner remembered"
                  : "Nothing promoted"}
            </p>
            <p className="truncate text-[8px] text-[var(--ink-tertiary)]">
              {complete ? "Ready for the next question" : "Only proven paths persist"}
            </p>
          </div>
          {evidence.recipeStored === true && (
            <Sparkles
              aria-hidden="true"
              className="ml-auto size-3.5 shrink-0 text-[#b49300]"
            />
          )}
        </div>
      </div>
    </section>
  );
}

export function SystemIntelligencePanel({
  reports,
}: {
  readonly reports: readonly AnalysisPerformanceReport[];
}) {
  const session = summarizeSystemIntelligence(reports);
  const latestArena =
    reports.find((report) => report.queryArena !== null)?.queryArena ?? null;
  const [proposal, setProposal] = useState<TuningProposal | null>(null);
  const [operatorName, setOperatorName] = useState("");
  const [tuningMessage, setTuningMessage] = useState<string | null>(null);
  const proposalMutation = useMutation({
    mutationFn: async () =>
      latestArena === null
        ? null
        : await createTuningProposal(latestArena.analysis),
    onSuccess: (result) => {
      if (result === null) {
        return;
      }

      if (result.isErr()) {
        setTuningMessage(result.error.message);
        return;
      }

      setProposal(result.value);
      setTuningMessage(null);
    },
  });
  const decisionMutation = useMutation({
    mutationFn: async (decision: "approve" | "reject") => {
      if (proposal === null || operatorName.trim().length < 2) {
        return null;
      }

      return await decideTuningProposal(
        proposal.id,
        decision === "approve"
          ? {
              decision,
              approver: operatorName.trim(),
            }
          : {
              decision,
              approver: operatorName.trim(),
              reason: "Keep the current physical layout",
            },
      );
    },
    onSuccess: (result) => {
      if (result === null) {
        setTuningMessage("Add your name before making this decision.");
        return;
      }

      if (result.isErr()) {
        setTuningMessage(result.error.message);
        return;
      }

      setProposal(result.value.proposal);
      setTuningMessage(
        result.value.execution.status === "queued"
          ? "Trigger.dev is applying the approved change."
          : result.value.execution.reason,
      );
    },
  });
  const telemetryVersion = reports
    .map(
      (report) =>
        `${report.id}:${report.queryArena?.status ?? "none"}:${String(
          report.queryArena?.recipeStored,
        )}`,
    )
    .join("|");
  const telemetry = useQuery({
    queryKey: ["system-intelligence", telemetryVersion],
    queryFn: async () => await loadSystemIntelligence(),
    staleTime: 10_000,
  });
  const deployment =
    telemetry.data?.isOk() === true && telemetry.data.value.available
      ? telemetry.data.value
      : null;
  const metricCards =
    deployment === null
      ? [
          {
            label: "Questions traced",
            value: String(session.tracedQuestions),
          },
          {
            label: "Safe races",
            value: String(session.verifiedRaces),
          },
          {
            label: "Paths learned",
            value: String(session.learnedRecipes),
          },
          {
            label: "Best lift",
            value:
              session.bestSpeedup === null
                ? "—"
                : `${session.bestSpeedup.toFixed(2)}×`,
          },
        ]
      : [
          {
            label: "Verified races",
            value: String(deployment.verifiedRaces),
          },
          {
            label: "Paths learned",
            value: String(deployment.recipeActivations),
          },
          {
            label: "Question families",
            value: String(deployment.semanticFamilies),
          },
          {
            label: "Exact reuse",
            value:
              deployment.exactHitRate === null
                ? "—"
                : `${Math.round(deployment.exactHitRate * 100)}%`,
          },
        ];

  return (
    <section className="analysis-tile col-span-12 overflow-hidden p-4 lg:col-span-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-[9px] text-[var(--ink-tertiary)]">
            System intelligence
          </p>
          <p className="mt-0.5 text-sm font-semibold text-[var(--ink)]">
            {deployment === null
              ? "Lens learns as you ask"
              : "Learning across conversations"}
          </p>
        </div>
        <span className="grid size-8 place-items-center rounded-xl bg-[#f4f0ff] text-[#704bd1]">
          <Sparkles aria-hidden="true" className="size-3.5" />
        </span>
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-2">
        {metricCards.map((metric) => (
          <div
            className="rounded-xl border border-[var(--line)] bg-white/42 px-3 py-2"
            key={metric.label}
          >
            <dt className="text-[8px] text-[var(--ink-tertiary)]">
              {metric.label}
            </dt>
            <dd className="mt-1 font-mono text-sm font-semibold text-[var(--ink)]">
              {metric.value}
            </dd>
          </div>
        ))}
      </dl>

      {deployment !== null &&
      deployment.baselineP95Ms !== null &&
      deployment.winnerP95Ms !== null ? (
        <div className="mt-3 rounded-xl bg-[#f4f6fb]/80 px-3 py-2">
          <div className="flex items-center justify-between gap-3">
            <p className="text-[8px] text-[var(--ink-tertiary)]">
              Slowest answers
            </p>
            <p className="font-mono text-[8px] font-semibold text-[#168f8a]">
              {formatDuration(deployment.baselineP95Ms)} →{" "}
              {formatDuration(deployment.winnerP95Ms)}
            </p>
          </div>
          <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-[#dfe3ee]">
            <div
              className="h-full rounded-full bg-[#21c5be]"
              style={{
                width: `${Math.max(
                  6,
                  Math.min(
                    100,
                    (deployment.winnerP95Ms /
                      Math.max(deployment.baselineP95Ms, 1)) *
                      100,
                  ),
                )}%`,
              }}
            />
          </div>
        </div>
      ) : (
        <div className="mt-3 flex items-center justify-between gap-3">
          <p className="text-[8px] text-[var(--ink-tertiary)]">
            Recent learning signal
          </p>
          <div
            aria-label="Recent learning signal"
            className="flex items-center gap-1"
            role="img"
          >
            {[...reports].reverse().map((report) => (
              <span
                className={`size-2 rounded-full ${
                  report.queryArena?.recipeStored === true
                    ? "bg-[#21c5be]"
                    : report.queryArena?.status === "running"
                      ? "animate-pulse bg-[#885cf6]"
                      : report.queryArena?.verified === true
                        ? "bg-[#8796d6]"
                        : "bg-[#dfe1ea]"
                }`}
                key={report.id}
                title={report.question}
              />
            ))}
            {reports.length === 0 && (
              <span className="text-[8px] text-[var(--ink-tertiary)]">
                Waiting for a question
              </span>
            )}
          </div>
        </div>
      )}

      {latestArena !== null && (
        <div className="mt-3 border-t border-[var(--line)] pt-3">
          <button
            className="flex w-full items-center justify-between rounded-xl bg-[#f4f0ff] px-3 py-2 text-left text-[9px] font-semibold text-[#704bd1] transition-colors hover:bg-[#eee7ff] disabled:opacity-55"
            disabled={proposalMutation.isPending}
            onClick={() => proposalMutation.mutate()}
            type="button"
          >
            <span className="inline-flex items-center gap-2">
              <DatabaseZap aria-hidden="true" className="size-3.5" />
              {proposalMutation.isPending
                ? "Checking repeated demand…"
                : "Review a storage upgrade"}
            </span>
            <span aria-hidden="true">→</span>
          </button>
          {tuningMessage !== null && proposal === null && (
            <p className="mt-2 line-clamp-2 text-[8px] leading-4 text-[var(--ink-tertiary)]">
              {tuningMessage}
            </p>
          )}
        </div>
      )}

      {proposal !== null && (
        <div className="fixed inset-0 z-[220] grid place-items-center bg-[#202334]/20 p-6 backdrop-blur-sm">
          <div className="relative w-full max-w-2xl">
            <button
              aria-label="Close storage proposal"
              className="absolute right-4 top-4 z-10 grid size-8 place-items-center rounded-full bg-white/80 text-slate-600"
              onClick={() => setProposal(null)}
              type="button"
            >
              <X aria-hidden="true" className="size-4" />
            </button>
            <TuningProposalCard
              onApprove={() => decisionMutation.mutate("approve")}
              onReject={() => decisionMutation.mutate("reject")}
              proposal={proposal}
            />
            {proposal.state === "validated" && (
              <div className="mx-5 -mt-3 rounded-b-2xl bg-white/82 px-4 pb-4 pt-5">
                <label className="text-[10px] font-medium text-slate-600">
                  Approval name
                  <input
                    className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-950 outline-none focus:border-violet-400"
                    onChange={(event) => setOperatorName(event.target.value)}
                    placeholder="Your name"
                    value={operatorName}
                  />
                </label>
              </div>
            )}
            {tuningMessage !== null && (
              <p className="mx-5 rounded-b-2xl bg-white/82 px-4 pb-4 text-xs text-slate-600">
                {tuningMessage}
              </p>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
