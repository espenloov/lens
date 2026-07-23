import type { AnalysisToolOutput } from "@/lib/analysis/tool-output";

import { AnalysisFailureNotice } from "./analysis-failure-notice";
import { TimeSeriesAnalysis } from "./time-series-analysis";
import { GrammarAnalysis } from "./grammar-analysis";
import { ExplorationAnalysis } from "./exploration-analysis";

type AnalysisResultProps = {
  readonly output: AnalysisToolOutput;
};

export function AnalysisResult({ output }: AnalysisResultProps) {
  if (output.status === "unsupported") {
    return (
      <AnalysisFailureNotice
        message={output.error.message}
        stage="agent"
      >
        <p className="text-sm font-medium text-slate-800">This analysis is not available yet.</p>
        <p className="mt-1 text-sm text-slate-500">{output.error.message}</p>
      </AnalysisFailureNotice>
    );
  }

  if (output.request.shape === "exploration") {
    return <ExplorationAnalysis plan={output.plan} request={output.request} />;
  }

  return output.request.shape === "time_series" ? (
    <TimeSeriesAnalysis plan={output.plan} request={output.request} />
  ) : (
    <GrammarAnalysis plan={output.plan} request={output.request} />
  );
}
