"use client";

import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";

import { useAnalysisPerformance } from "@/components/analysis/performance-context";
import { DashboardAssembly } from "@/components/dashboard-assembly";
import type { AnalysisPlan } from "@/lib/analysis/contracts";
import type { TimeSeriesRequest } from "@/lib/time-series/contracts";
import { loadTimeSeries } from "@/lib/time-series/load";
import { supportsQueryArena } from "@/lib/query-arena/signature";

import { QueryArenaReporter } from "./query-arena-reporter";
import { TimeSeriesTrace } from "./time-series-trace";

type TimeSeriesAnalysisProps = {
  readonly plan: AnalysisPlan;
  readonly request: TimeSeriesRequest;
};

export function TimeSeriesAnalysis({
  plan,
  request,
}: TimeSeriesAnalysisProps) {
  const { failAnalysis, reportAnalysis } = useAnalysisPerformance();
  const query = useQuery({
    queryKey: ["time-series", request],
    queryFn: async () => loadTimeSeries(request),
    retry: false,
  });

  useEffect(() => {
    if (query.data?.isOk() !== true) {
      return;
    }

    const loaded = query.data.value;
    reportAnalysis({
      title: plan.title,
      kind: request.operation,
      queryId: loaded.queryId,
      contract: "time_series/v1",
      arrowBytes: loaded.arrowBytes,
      typedRows: loaded.columns.rowCount,
      roundTripMs: loaded.performance.roundTripMs,
      wasmStartupMs: loaded.performance.wasmStartupWaitMs,
      rustDecodeMs: loaded.performance.rustDecodeMs,
      rustComputeMs: loaded.performance.rustTransformMs,
    });
  }, [plan.title, query.data, reportAnalysis, request.operation]);

  useEffect(() => {
    if (query.isError) {
      failAnalysis("clickhouse", "The time-series request failed unexpectedly.");
      return;
    }

    if (query.data?.isErr() === true) {
      failAnalysis(
        query.data.error.kind === "time-series-wasm" ? "rust" : "clickhouse",
        query.data.error.message,
      );
    }
  }, [failAnalysis, query.data, query.isError]);

  if (query.isPending) {
    return (
      <div className="h-full min-h-[24rem]">
        <DashboardAssembly settling={false} />
      </div>
    );
  }

  if (query.isError) {
    return (
      <p className="glass-panel rounded-2xl p-5 text-sm text-destructive" role="alert">
        The time-series pipeline failed unexpectedly.
      </p>
    );
  }

  if (query.data.isErr()) {
    return (
      <section className="glass-panel space-y-2 rounded-2xl p-5" role="alert">
        <p className="text-sm font-medium">The analysis could not be loaded.</p>
        <p className="text-sm text-muted-foreground">
          {query.data.error.message}
        </p>
      </section>
    );
  }

  const loaded = query.data.value;

  return (
    <div className="dashboard-revealing">
      {loaded.queryId !== null && supportsQueryArena(request) && (
        <QueryArenaReporter
          analysis={{ kind: "time_series", request }}
          currentStrategy={loaded.strategy}
          queryId={loaded.queryId}
        />
      )}
      <TimeSeriesTrace
        explanation={plan.explanation}
        loaded={loaded}
        request={request}
        title={plan.title}
      />
    </div>
  );
}
