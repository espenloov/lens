import type { AnalysisToolOutput } from "@/lib/analysis/tool-output";

import { TimeSeriesAnalysis } from "./time-series-analysis";
import { GrammarAnalysis } from "./grammar-analysis";
import { ExplorationAnalysis } from "./exploration-analysis";

type AnalysisResultProps = {
  readonly output: AnalysisToolOutput;
};

export function AnalysisResult({ output }: AnalysisResultProps) {
  if (output.status === "unsupported") {
    return (
      <section
        aria-label="Unsupported analysis"
        className="space-y-2 border-y py-5"
      >
        <p className="text-sm font-medium">This analysis is not available yet.</p>
        <p className="text-sm text-muted-foreground">{output.error.message}</p>
      </section>
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
