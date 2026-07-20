import type { YearlyAveragePriceResult } from "@/lib/analysis/results";

import { getPerformanceEvidence } from "./formatters";

type PerformanceProofProps = {
  readonly performance: YearlyAveragePriceResult["performance"];
  readonly queryId: string;
};

export function PerformanceProof({
  performance,
  queryId,
}: PerformanceProofProps) {
  const evidence = getPerformanceEvidence(performance);

  return (
    <footer
      aria-label="ClickHouse query performance"
      className="border-t pt-4"
    >
      <p className="flex flex-wrap gap-x-2 gap-y-1 font-mono text-xs text-muted-foreground">
        {evidence.facts.map((fact, index) => (
          <span key={fact}>
            {index > 0 && <span aria-hidden="true">· </span>}
            {fact}
          </span>
        ))}
      </p>

      {evidence.outsideQueryInference !== null && (
        <p className="mt-2 text-xs text-muted-foreground">
          {evidence.outsideQueryInference}
        </p>
      )}

      <details className="mt-2 text-xs text-muted-foreground">
        <summary className="w-fit cursor-pointer select-none">Query details</summary>
        <p className="mt-2 break-all font-mono">Query ID: {queryId}</p>
      </details>
    </footer>
  );
}
