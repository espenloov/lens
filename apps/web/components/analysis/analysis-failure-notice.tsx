"use client";

import { useEffect, type ReactNode } from "react";
import { ArrowUpRight } from "lucide-react";

import { useAnalysisNavigation } from "./analysis-navigation";
import {
  useAnalysisPerformance,
  type AnalysisFailureStage,
} from "./performance-context";

export function AnalysisFailureNotice({
  children,
  message,
  stage,
}: {
  readonly children: ReactNode;
  readonly message: string;
  readonly stage: AnalysisFailureStage;
}) {
  const { failAnalysis } = useAnalysisPerformance();
  const { openPerformance } = useAnalysisNavigation();

  useEffect(() => {
    failAnalysis(stage, message);
  }, [failAnalysis, message, stage]);

  return (
    <section
      className="glass-panel flex items-center justify-between gap-5 rounded-2xl p-5"
      role="alert"
    >
      <div>{children}</div>
      <button
        className="inline-flex shrink-0 items-center gap-2 rounded-xl bg-[var(--lens-dark)] px-3 py-2 text-[10px] font-semibold text-white"
        onClick={() => openPerformance("flow")}
        type="button"
      >
        View failure path
        <ArrowUpRight aria-hidden="true" className="size-3.5" />
      </button>
    </section>
  );
}
