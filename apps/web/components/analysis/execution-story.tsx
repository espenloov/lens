import type { ReactNode } from "react";
import { ChevronDown } from "lucide-react";

export type ExecutionMetric = {
  readonly label: string;
  readonly value: string;
};

type ExecutionStoryProps = {
  readonly summary: string;
  readonly metrics: readonly ExecutionMetric[];
  readonly queryId?: string | null;
  readonly children?: ReactNode;
};

const STAGES = [
  ["Trigger.dev", "Validated the plan and coordinated durable execution.", "var(--trigger)"],
  ["ClickHouse", "Scanned and filtered the analytical columns.", "var(--clickhouse)"],
  ["Arrow", "Transferred a compact typed binary result.", "var(--arrow)"],
  ["Rust / WASM", "Decoded and analysed the result in browser memory.", "var(--rust)"],
] as const;

export function ExecutionStory({
  summary,
  metrics,
  queryId,
  children,
}: ExecutionStoryProps) {
  return (
    <details className="group analysis-tile col-span-12 overflow-hidden">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-3 marker:hidden sm:px-6">
        <div className="min-w-0">
          <p className="text-xs font-medium text-[#66758e]">How this answer ran</p>
          <p className="mt-1 truncate text-sm font-medium text-[#09265b]">{summary}</p>
        </div>
        <ChevronDown
          aria-hidden="true"
          className="size-4 shrink-0 text-[#66758e] transition-transform group-open:rotate-180 motion-reduce:transition-none"
        />
      </summary>

      <div className="border-t border-[#09265b]/8 px-5 py-6 sm:px-6">
        <ol className="grid gap-5 md:grid-cols-4">
          {STAGES.map(([label, detail, color], index) => (
            <li className="relative border-l-2 pl-4" key={label} style={{ borderColor: color }}>
              <p className="text-sm font-semibold text-[#09265b]">
                <span className="mr-2 text-xs font-normal text-[#8591a5]">0{index + 1}</span>
                {label}
              </p>
              <p className="mt-2 text-xs leading-5 text-[#66758e]">{detail}</p>
            </li>
          ))}
        </ol>

        <dl className="mt-6 grid grid-cols-2 gap-x-6 gap-y-4 border-t border-[#09265b]/8 pt-5 md:grid-cols-4">
          {metrics.map((metric) => (
            <div key={metric.label}>
              <dt className="text-xs text-[#66758e]">{metric.label}</dt>
              <dd className="mt-1 font-mono text-xs font-medium tabular-nums text-[#09265b]">
                {metric.value}
              </dd>
            </div>
          ))}
        </dl>

        {queryId && (
          <p className="mt-5 truncate border-t border-[#09265b]/8 pt-4 font-mono text-xs text-[#66758e]">
            ClickHouse query {queryId}
          </p>
        )}

        {children}
      </div>
    </details>
  );
}
