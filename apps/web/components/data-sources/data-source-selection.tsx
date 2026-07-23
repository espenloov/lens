"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  Database,
  Plus,
} from "lucide-react";
import { useRouter } from "next/navigation";

import { BrandMark } from "@/components/brand-mark";
import { DataSourceManager } from "@/components/data-sources/data-source-manager";
import { fetchDataSources } from "@/lib/data-sources/client";
import {
  BUILTIN_DATA_SOURCE,
  toDataSourceSummary,
} from "@/lib/data-sources/builtin";
import type { DataSourceSummary } from "@/lib/data-sources/contracts";

function formatRows(value: number): string {
  return new Intl.NumberFormat("en-GB", {
    notation: value >= 1_000_000 ? "compact" : "standard",
    maximumFractionDigits: 1,
  }).format(value);
}

function capabilityCount(source: DataSourceSummary): number {
  return Object.values(source.capabilities.operations).filter(Boolean).length;
}

export function DataSourceSelection() {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const sources = useQuery({
    queryKey: ["data-sources"],
    queryFn: async () => await fetchDataSources(),
    staleTime: 10_000,
    retry: false,
  });
  const registry =
    sources.data?.isOk() === true ? sources.data.value : null;
  const availableSources =
    registry?.sources ?? [toDataSourceSummary(BUILTIN_DATA_SOURCE, true)];
  const error =
    sources.data?.isErr() === true ? sources.data.error : null;

  function openSource(source: DataSourceSummary) {
    const parameters = new URLSearchParams({
      dataset: source.slug,
      version: String(source.version),
      chat: crypto.randomUUID(),
    });
    router.push(`/?${parameters.toString()}`);
  }

  if (adding) {
    return (
      <section className="grid h-full min-h-0 grid-rows-[56px_minmax(0,1fr)]">
        <header className="flex items-center justify-between border-b border-[#09265b]/8 px-5 sm:px-7">
          <button
            aria-label="Back to data sources"
            onClick={() => setAdding(false)}
            type="button"
          >
            <BrandMark label size={40} />
          </button>
          <span className="text-xs text-[var(--ink-tertiary)]">Add data source</span>
        </header>
        <div className="min-h-0 p-4 sm:p-6">
          <DataSourceManager
            initialAdding
            onCancel={() => setAdding(false)}
            onDatasetChanged={openSource}
          />
        </div>
      </section>
    );
  }

  return (
    <section className="flex h-full min-h-0 flex-col px-5 py-5 sm:px-8 sm:py-7 lg:px-10 lg:py-8">
      <header className="flex items-center justify-between">
        <BrandMark label size={48} />
        <span className="flex items-center gap-2 text-xs text-[var(--ink-tertiary)]">
          <span className="size-2 rounded-full bg-[#21c5be]" />
          ClickHouse connected
        </span>
      </header>

      <div className="mx-auto grid min-h-0 w-full max-w-6xl flex-1 items-center gap-4 py-5 lg:grid-cols-[0.9fr_1.5fr] lg:py-8">
        <section className="brand-hero analysis-tile relative flex min-h-64 flex-col justify-between p-7 lg:h-[30rem] lg:p-9">
          <div className="relative z-10">
            <p className="text-xs font-semibold tracking-[0.08em] text-[var(--ink-tertiary)]">
              Data, brought into focus
            </p>
            <h1 className="mt-5 max-w-md text-balance text-4xl font-semibold leading-[1.02] tracking-[-0.055em] text-[var(--ink)] lg:text-[3.4rem]">
              Ask your data. Get a dashboard.
            </h1>
            <p className="mt-5 max-w-sm text-sm leading-6 text-[var(--ink-secondary)]">
              Select a source and turn millions of rows into an interactive answer.
            </p>
          </div>
          <div className="relative z-10 mt-8 flex items-end justify-between">
            <span className="rounded-full border border-white/80 bg-white/55 px-3 py-1.5 text-[11px] font-medium text-[var(--ink-secondary)] backdrop-blur-xl">
              ClickHouse · Arrow · Rust
            </span>
            <BrandMark className="drop-shadow-[0_22px_30px_rgb(45_57_84_/_18%)]" size={132} />
          </div>
        </section>

        <section className="min-w-0 px-1 lg:px-3">
          <div className="flex items-end justify-between gap-4">
            <div>
              <p className="text-xs font-medium text-[var(--ink-tertiary)]">
                Your workspaces
              </p>
              <h2 className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-[var(--ink)]">
                Choose a data source
              </h2>
            </div>
            <span className="hidden text-xs text-[var(--ink-tertiary)] sm:block">
              {availableSources.length} ready
            </span>
          </div>

          <div className="mt-6 grid min-h-0 gap-3 sm:grid-cols-2">
            {sources.isLoading
              ? [0, 1].map((index) => (
                  <div
                    aria-hidden="true"
                    className={`analysis-tile min-h-44 animate-pulse p-5 ${
                      index === 0 ? "sm:col-span-2" : ""
                    }`}
                    key={index}
                  >
                    <span className="block size-10 rounded-[0.9rem] bg-[#eef1f6]" />
                    <span className="mt-14 block h-4 w-2/5 rounded-full bg-[#e8ecf3]" />
                    <span className="mt-3 block h-3 w-1/3 rounded-full bg-[#eef1f6]" />
                  </div>
                ))
              : availableSources.map((source, index) => (
                  <button
                    className={`analysis-tile group flex min-h-44 flex-col p-5 text-left transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-[0_24px_50px_rgb(45_57_84_/_11%)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#697cc7] motion-reduce:transition-none ${
                      index === 0 ? "sm:col-span-2" : ""
                    }`}
                    key={`${source.slug}:${source.version}`}
                    onClick={() => openSource(source)}
                    type="button"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <span className="grid size-10 place-items-center rounded-[0.9rem] bg-[#f5c400]/13 text-[#8b7100]">
                        <Database aria-hidden="true" className="size-4" />
                      </span>
                      <span className="flex items-center gap-1.5 text-[10px] font-semibold text-[#176f6b]">
                        <span className="size-1.5 rounded-full bg-[#21c5be]" />
                        Ready
                      </span>
                    </div>
                    <div className="mt-auto pt-7">
                      <h3 className="truncate text-base font-semibold tracking-[-0.025em] text-[var(--ink)]">
                        {source.displayName}
                      </h3>
                      <div className="mt-2 flex items-center gap-2 text-xs text-[var(--ink-tertiary)]">
                        <span>{formatRows(source.rowCount)} rows</span>
                        <span aria-hidden="true">·</span>
                        <span>{capabilityCount(source)} analysis modes</span>
                      </div>
                    </div>
                    <ArrowRight
                      aria-hidden="true"
                      className="mt-4 size-4 text-[#697cc7] transition-transform group-hover:translate-x-1"
                    />
                  </button>
                ))}

            <button
              className="group flex min-h-44 flex-col rounded-[1.35rem] border border-dashed border-[#8796d6]/32 bg-white/28 p-5 text-left transition-[background,border-color] hover:border-[#8796d6]/65 hover:bg-white/48 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#697cc7]"
              onClick={() => setAdding(true)}
              type="button"
            >
              <span className="grid size-10 place-items-center rounded-[0.9rem] bg-[#8796d6]/10 text-[#697cc7]">
                <Plus aria-hidden="true" className="size-4" />
              </span>
              <div className="mt-auto pt-7">
                <h3 className="text-base font-semibold tracking-[-0.025em] text-[var(--ink)]">
                  Add data source
                </h3>
                <p className="mt-2 text-xs text-[var(--ink-tertiary)]">
                  Connect another ClickHouse table
                </p>
              </div>
            </button>
          </div>

          {error !== null && (
            <p className="mt-5 text-xs text-[#9f3948]">{error.message}</p>
          )}
        </section>
      </div>
    </section>
  );
}
