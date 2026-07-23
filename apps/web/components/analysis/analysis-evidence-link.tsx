"use client";

import { ArrowUpRight, Gauge, Zap } from "lucide-react";

import { useAnalysisNavigation } from "./analysis-navigation";

export function AnalysisEvidenceLink({
  optimizationAvailable = false,
}: {
  readonly optimizationAvailable?: boolean;
}) {
  const { openPerformance } = useAnalysisNavigation();

  return (
    <section
      className="analysis-tile col-span-12 flex flex-wrap items-center justify-between gap-3 px-4 py-3"
      data-living-role="evidence"
    >
      <div className="flex items-center gap-3">
        <span className="grid size-8 place-items-center rounded-xl bg-[#8796d6]/10 text-[#5c6db0]">
          <Gauge aria-hidden="true" className="size-4" />
        </span>
        <div>
          <p className="text-xs font-semibold text-[var(--ink)]">
            Evidence is ready
          </p>
          <p className="text-[10px] text-[var(--ink-tertiary)]">
            Inspect the measured path behind this dashboard.
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        {optimizationAvailable && (
          <button
            className="inline-flex items-center gap-2 rounded-xl border border-[var(--line)] bg-white/62 px-3 py-2 text-[10px] font-semibold text-[var(--ink-secondary)] transition-colors hover:bg-white"
            onClick={() => openPerformance("arena")}
            type="button"
          >
            <Zap aria-hidden="true" className="size-3.5 text-[#7b58dc]" />
            Optimization
          </button>
        )}
        <button
          className="inline-flex items-center gap-2 rounded-xl bg-[var(--lens-dark)] px-3 py-2 text-[10px] font-semibold text-white transition-colors hover:bg-[#3a4050]"
          onClick={() => openPerformance("flow")}
          type="button"
        >
          Performance
          <ArrowUpRight aria-hidden="true" className="size-3.5" />
        </button>
      </div>
    </section>
  );
}
