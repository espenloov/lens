import type { AnalysisToolOutput } from "@/lib/analysis/tool-output";

import { YearlyPriceTrace } from "./yearly-price-trace";

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

  return (
    <YearlyPriceTrace
      explanation={output.plan.explanation}
      key={output.result.queryId}
      result={output.result}
      title={output.plan.title}
    />
  );
}
