"use client";

import { useState } from "react";
import { ResultAsync } from "neverthrow";

import { Button } from "@/components/ui/button";
import type { TimeSeriesRequest } from "@/lib/time-series/contracts";
import { analyzeTimeSeries } from "@/lib/wasm/time-series";

type ProbeScenario = {
  readonly id: string;
  readonly title: string;
  readonly request: TimeSeriesRequest;
};

const SCENARIOS: readonly ProbeScenario[] = [
  {
    id: "manchester-yearly-average",
    title: "Manchester yearly average price",
    request: {
      shape: "time_series",
      dataset: "uk_price_paid",
      operation: "trend",
      metric: "average_price",
      interval: "year",
      seriesBy: "town",
      transform: "value",
      anomalyThreshold: null,
      filters: {
        dateFrom: "2015-01-01",
        dateTo: "2023-12-31",
        location: {
          level: "town",
          values: ["MANCHESTER"],
        },
        propertyTypes: [],
        newBuild: null,
        tenure: [],
        minimumPrice: null,
        maximumPrice: null,
      },
    },
  },
  {
    id: "leeds-bristol-monthly-volume",
    title: "Leeds vs Bristol monthly volume",
    request: {
      shape: "time_series",
      dataset: "uk_price_paid",
      operation: "comparison",
      metric: "transaction_count",
      interval: "month",
      seriesBy: "town",
      transform: "value",
      anomalyThreshold: null,
      filters: {
        dateFrom: "2020-01-01",
        dateTo: "2023-12-31",
        location: {
          level: "town",
          values: ["LEEDS", "BRISTOL"],
        },
        propertyTypes: [],
        newBuild: null,
        tenure: [],
        minimumPrice: null,
        maximumPrice: null,
      },
    },
  },
];

type ProbeState =
  | { readonly status: "idle" }
  | { readonly status: "running"; readonly scenarioId: string }
  | {
      readonly status: "completed";
      readonly title: string;
      readonly rowCount: number;
      readonly seriesCount: number;
      readonly minimumValue: number | null;
      readonly maximumValue: number | null;
      readonly byteLength: number;
      readonly durationMs: number;
    }
  | {
      readonly status: "failed";
      readonly message: string;
    };

type ArrowFetchError = {
  readonly kind: "arrow-fetch";
  readonly message: string;
};

async function fetchArrowBytes(
  request: TimeSeriesRequest,
): Promise<Uint8Array> {
  const response = await fetch("/api/arrow/time-series", {
    method: "POST",
    cache: "no-store",
    headers: {
      Accept: "application/vnd.apache.arrow.stream",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    throw new Error(`Arrow endpoint returned HTTP ${response.status}`);
  }

  return new Uint8Array(await response.arrayBuffer());
}

function describeError(cause: unknown): string {
  if (cause instanceof Error) {
    return cause.message;
  }

  return String(cause);
}

function formatValue(value: number | null): string {
  return value === null ? "—" : Math.round(value).toLocaleString("en-GB");
}

function executeProbe(scenario: ProbeScenario) {
  const startedAt = performance.now();
  const arrowBytes = ResultAsync.fromPromise(
    fetchArrowBytes(scenario.request),
    (cause): ArrowFetchError => ({
      kind: "arrow-fetch",
      message: describeError(cause),
    }),
  );

  return arrowBytes.andThen((bytes) =>
    analyzeTimeSeries(bytes).map((analysis) => ({
      ...analysis,
      byteLength: bytes.byteLength,
      durationMs: performance.now() - startedAt,
    })),
  );
}

export function TimeSeriesProbe() {
  const [state, setState] = useState<ProbeState>({ status: "idle" });

  function runProbe(scenario: ProbeScenario) {
    setState({ status: "running", scenarioId: scenario.id });

    void executeProbe(scenario).match(
        (result) => {
          setState({
            status: "completed",
            title: scenario.title,
            ...result,
          });
        },
        (error) => {
          setState({
            status: "failed",
            message: error.message,
          });
        },
      );
  }

  return (
    <section className="w-full max-w-2xl space-y-6 rounded-xl border p-6">
      <div>
        <h1 className="text-2xl font-semibold">Generic time-series engine</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Two different analytical questions use one Arrow schema and one Rust
          kernel.
        </p>
      </div>

      <div className="flex flex-wrap gap-3">
        {SCENARIOS.map((scenario) => {
          const isRunning =
            state.status === "running" && state.scenarioId === scenario.id;

          return (
            <Button
              key={scenario.id}
              type="button"
              variant="outline"
              disabled={state.status === "running"}
              onClick={() => runProbe(scenario)}
            >
              {isRunning ? "Running…" : scenario.title}
            </Button>
          );
        })}
      </div>

      {state.status === "completed" && (
        <div className="space-y-3">
          <p className="font-medium">{state.title}</p>
          <dl className="grid grid-cols-2 gap-4 rounded-lg bg-muted p-4 sm:grid-cols-3">
            <div>
              <dt className="text-xs text-muted-foreground">Arrow bytes</dt>
              <dd className="mt-1 font-mono">{state.byteLength}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Rows</dt>
              <dd className="mt-1 font-mono">{state.rowCount}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Series</dt>
              <dd className="mt-1 font-mono">{state.seriesCount}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Minimum</dt>
              <dd className="mt-1 font-mono">
                {formatValue(state.minimumValue)}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Maximum</dt>
              <dd className="mt-1 font-mono">
                {formatValue(state.maximumValue)}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Total time</dt>
              <dd className="mt-1 font-mono">
                {state.durationMs.toFixed(1)} ms
              </dd>
            </div>
          </dl>
        </div>
      )}

      {state.status === "failed" && (
        <p className="text-sm text-destructive">{state.message}</p>
      )}
    </section>
  );
}
