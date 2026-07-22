"use client";

import { useState } from "react";
import { ResultAsync } from "neverthrow";

import { Button } from "@/components/ui/button";
import { countYearlyPriceRows } from "@/lib/wasm/yearly-price";

type ProbeState =
  | { readonly status: "idle" }
  | { readonly status: "running" }
  | {
      readonly status: "completed";
      readonly rowCount: number;
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

async function fetchArrowBytes(): Promise<Uint8Array> {
  const response = await fetch("/api/arrow/yearly-prices", {
    method: "GET",
    cache: "no-store",
    headers: {
      Accept: "application/vnd.apache.arrow.stream",
    },
  });

  if (!response.ok) {
    throw new Error(`Arrow endpoint returned HTTP ${response.status}`);
  }

  // The network response is binary, not JSON.
  const buffer = await response.arrayBuffer();

  // Uint8Array gives wasm-bindgen a byte-oriented view of that buffer.
  return new Uint8Array(buffer);
}

function describeError(cause: unknown): string {
  if (cause instanceof Error) {
    return cause.message;
  }

  return String(cause);
}

export function YearlyPriceProbe() {
  const [state, setState] = useState<ProbeState>({ status: "idle" });

  function runProbe() {
    setState({ status: "running" });

    const startedAt = performance.now();

    const arrowBytes = ResultAsync.fromPromise(
      fetchArrowBytes(),
      (cause): ArrowFetchError => ({
        kind: "arrow-fetch",
        message: describeError(cause),
      }),
    );

    void arrowBytes
      .andThen((bytes) =>
        countYearlyPriceRows(bytes).map((rowCount) => ({
          rowCount,
          byteLength: bytes.byteLength,
          durationMs: performance.now() - startedAt,
        })),
      )
      .match(
        (result) => {
          setState({
            status: "completed",
            rowCount: result.rowCount,
            byteLength: result.byteLength,
            durationMs: result.durationMs,
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
    <section className="w-full max-w-xl space-y-6 rounded-xl border p-6">
      <div>
        <h1 className="text-2xl font-semibold">Arrow → Rust/WASM proof</h1>

        <p className="mt-2 text-sm text-muted-foreground">
          Fetch a binary Arrow stream from ClickHouse and decode it inside the
          browser using Rust compiled to WebAssembly.
        </p>
      </div>

      <Button
        type="button"
        disabled={state.status === "running"}
        onClick={runProbe}
      >
        {state.status === "running" ? "Running…" : "Run browser proof"}
      </Button>

      {state.status === "completed" && (
        <dl className="grid grid-cols-3 gap-4 rounded-lg bg-muted p-4">
          <div>
            <dt className="text-xs text-muted-foreground">Arrow bytes</dt>
            <dd className="mt-1 font-mono">{state.byteLength}</dd>
          </div>

          <div>
            <dt className="text-xs text-muted-foreground">Rows from Rust</dt>
            <dd className="mt-1 font-mono">{state.rowCount}</dd>
          </div>

          <div>
            <dt className="text-xs text-muted-foreground">Total time</dt>
            <dd className="mt-1 font-mono">
              {state.durationMs.toFixed(1)} ms
            </dd>
          </div>
        </dl>
      )}

      {state.status === "failed" && (
        <p className="text-sm text-destructive">{state.message}</p>
      )}
    </section>
  );
}
