"use client";

import { Check, DatabaseZap, ShieldCheck, Undo2 } from "lucide-react";

import type { TuningProposal } from "@/lib/query-arena/tuning/contracts";

type TuningProposalCardProps = {
  readonly proposal: TuningProposal;
  readonly onApprove?: () => void;
  readonly onReject?: () => void;
};

function formatBytes(bytes: number): string {
  const gigabytes = bytes / 1_000_000_000;

  return gigabytes >= 0.1
    ? `${gigabytes.toFixed(1)} GB`
    : `${(bytes / 1_000_000).toFixed(0)} MB`;
}

export function TuningProposalCard({
  proposal,
  onApprove,
  onReject,
}: TuningProposalCardProps) {
  const p95 = proposal.evidence.p95ServerElapsedMs;
  const storage = proposal.estimate.estimatedStorageBytes;

  return (
    <section className="rounded-[28px] border border-white/70 bg-white/64 p-5 shadow-[0_24px_80px_rgba(47,55,97,0.10)] backdrop-blur-2xl">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="mb-3 flex items-center gap-2 text-xs font-medium text-slate-500">
            <DatabaseZap className="size-4 text-[#f9e547]" />
            ClickHouse physical proposal
          </div>
          <h3 className="text-lg font-semibold tracking-[-0.03em] text-slate-950">
            Reorder repeated analysis around {proposal.physicalColumns.join(", ")}
          </h3>
        </div>
        <span className="rounded-full bg-teal-50 px-3 py-1 text-xs font-medium text-teal-700">
          {proposal.state.replace("_", " ")}
        </span>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div className="rounded-2xl bg-white/80 p-3">
          <p className="text-[11px] text-slate-500">Repeated races</p>
          <p className="mt-1 text-lg font-semibold text-slate-950">
            {proposal.evidence.observedArenas}
          </p>
        </div>
        <div className="rounded-2xl bg-white/80 p-3">
          <p className="text-[11px] text-slate-500">Current p95</p>
          <p className="mt-1 text-lg font-semibold text-slate-950">
            {p95 === null ? "Unknown" : `${p95.toFixed(0)} ms`}
          </p>
        </div>
        <div className="rounded-2xl bg-white/80 p-3">
          <p className="text-[11px] text-slate-500">Verified trials</p>
          <p className="mt-1 text-lg font-semibold text-slate-950">
            {proposal.evidence.verifiedTrials}
          </p>
        </div>
        <div className="rounded-2xl bg-white/80 p-3">
          <p className="text-[11px] text-slate-500">Estimated storage</p>
          <p className="mt-1 text-lg font-semibold text-slate-950">
            {storage === null ? "Unknown" : `≤ ${formatBytes(storage.upper)}`}
          </p>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3 text-xs text-slate-600">
        <span className="inline-flex items-center gap-1.5">
          <ShieldCheck className="size-4 text-teal-600" />
          Whitelisted template
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Check className="size-4 text-teal-600" />
          Read-only validation passed
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Undo2 className="size-4 text-violet-600" />
          Reversible
        </span>
        <span>
          Predicted {proposal.estimate.predictedSpeedup.lower.toFixed(1)}–
          {proposal.estimate.predictedSpeedup.upper.toFixed(0)}×, verified after
          the next race
        </span>
      </div>

      {proposal.state === "validated" ? (
        <div className="mt-5 flex gap-2">
          <button
            className="rounded-full bg-slate-950 px-4 py-2 text-sm font-medium text-white"
            onClick={onApprove}
            type="button"
          >
            Approve optimization
          </button>
          <button
            className="rounded-full bg-white px-4 py-2 text-sm font-medium text-slate-700"
            onClick={onReject}
            type="button"
          >
            Keep current layout
          </button>
        </div>
      ) : null}
    </section>
  );
}
