"use client";

import { useQuery } from "@tanstack/react-query";

import type { AnalysisPlan } from "@/lib/analysis/contracts";
import type { TimeSeriesRequest } from "@/lib/time-series/contracts";
import { loadTimeSeries } from "@/lib/time-series/load";

import { TimeSeriesTrace } from "./time-series-trace";

type TimeSeriesAnalysisProps = {
  readonly plan: AnalysisPlan;
  readonly request: TimeSeriesRequest;
};

export function TimeSeriesAnalysis({
  plan,
  request,
}: TimeSeriesAnalysisProps) {
  const query = useQuery({
    queryKey: ["time-series", request],
    queryFn: async () => loadTimeSeries(request),
    retry: false,
  });

  if (query.isPending) {
    return (
      <section aria-live="polite" className="space-y-3 border-y py-8">
        <p className="text-sm font-medium">
          Waking ClickHouse and streaming Arrow data…
        </p>
        <div className="h-56 animate-pulse rounded-lg bg-muted" />
      </section>
    );
  }

  if (query.isError) {
    return (
      <p className="border-y py-5 text-sm text-destructive" role="alert">
        The time-series pipeline failed unexpectedly.
      </p>
    );
  }

  if (query.data.isErr()) {
    return (
      <section className="space-y-2 border-y py-5" role="alert">
        <p className="text-sm font-medium">The analysis could not be loaded.</p>
        <p className="text-sm text-muted-foreground">
          {query.data.error.message}
        </p>
      </section>
    );
  }

  return (
    <TimeSeriesTrace
      explanation={plan.explanation}
      loaded={query.data.value}
      request={request}
      title={plan.title}
    />
  );
}
