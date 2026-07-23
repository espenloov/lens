"use client";

import { LoaderCircle, Trash2, X } from "lucide-react";

import type { DataSourceSummary } from "@/lib/data-sources/contracts";

type DeleteDataSourceDialogProps = {
  readonly error: string | null;
  readonly pending: boolean;
  readonly source: DataSourceSummary;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
};

export function DeleteDataSourceDialog({
  error,
  pending,
  source,
  onCancel,
  onConfirm,
}: DeleteDataSourceDialogProps) {
  return (
    <div
      aria-labelledby="delete-data-source-title"
      aria-modal="true"
      className="fixed inset-0 z-[100] grid place-items-center bg-[#071a38]/20 p-5 backdrop-blur-md"
      role="dialog"
    >
      <section className="analysis-tile w-full max-w-md p-6 shadow-[0_32px_90px_rgb(7_26_56_/_24%)]">
        <div className="flex items-start justify-between gap-5">
          <span className="grid size-11 place-items-center rounded-2xl bg-[#ff6372]/10 text-[#b83448]">
            <Trash2 aria-hidden="true" className="size-5" />
          </span>
          <button
            aria-label="Cancel deletion"
            className="grid size-9 place-items-center rounded-xl text-[#66758e] transition-colors hover:bg-[#eef2f7] hover:text-[#09265b]"
            disabled={pending}
            onClick={onCancel}
            type="button"
          >
            <X aria-hidden="true" className="size-4" />
          </button>
        </div>

        <h2
          className="mt-5 text-xl font-semibold tracking-[-0.035em] text-[#09265b]"
          id="delete-data-source-title"
        >
          Delete {source.displayName}?
        </h2>
        <p className="mt-2 text-sm leading-6 text-[#66758e]">
          Its Lens mapping, versions, and validation profile will be removed.
          The ClickHouse table and historical run evidence stay untouched.
        </p>
        <p className="mt-4 truncate rounded-xl bg-[#f4f7fb] px-3 py-2.5 font-mono text-xs text-[#596983]">
          {source.database}.{source.table}
        </p>

        {error !== null && (
          <p className="mt-4 text-xs text-[#9f3948]">{error}</p>
        )}

        <div className="mt-6 grid grid-cols-2 gap-3">
          <button
            className="rounded-xl border border-[#09265b]/10 bg-white/70 px-4 py-3 text-sm font-semibold text-[#09265b]"
            disabled={pending}
            onClick={onCancel}
            type="button"
          >
            Keep source
          </button>
          <button
            className="flex items-center justify-center gap-2 rounded-xl bg-[#b83448] px-4 py-3 text-sm font-semibold text-white disabled:opacity-50"
            disabled={pending}
            onClick={onConfirm}
            type="button"
          >
            {pending ? (
              <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
            ) : (
              <Trash2 aria-hidden="true" className="size-4" />
            )}
            Delete {source.displayName}
          </button>
        </div>
      </section>
    </div>
  );
}
