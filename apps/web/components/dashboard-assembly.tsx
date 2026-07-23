import { BrandMark } from "@/components/brand-mark";

type DashboardAssemblyProps = {
  readonly settling: boolean;
};

const TILES = [
  ["Shaping the signal", "Main view"],
  ["Finding what matters", "Key insight"],
  ["Comparing the values", "Selected focus"],
  ["Streaming typed data", "Arrow"],
  ["Verifying the answer", "Performance"],
] as const;

function TilePreview({ index }: { readonly index: number }) {
  if (index === 0) {
    return (
      <svg aria-hidden="true" className="mt-auto h-24 w-full" viewBox="0 0 360 96">
        <path d="M4 80 C45 72 58 40 94 52 S151 76 184 34 S244 56 286 24 S329 21 356 12" fill="none" stroke="var(--chart-1)" strokeWidth="3" />
        <path d="M4 86 C43 78 67 67 101 72 S161 47 200 58 S265 38 356 31" fill="none" stroke="var(--chart-2)" strokeWidth="3" />
      </svg>
    );
  }

  if (index === 1) {
    return (
      <div aria-hidden="true" className="mt-auto space-y-2">
        <span className="block h-3 w-4/5 rounded-full bg-[#09265b]/10" />
        <span className="block h-3 w-3/5 rounded-full bg-[#09265b]/10" />
      </div>
    );
  }

  if (index === 2) {
    return (
      <div aria-hidden="true" className="mt-auto grid grid-cols-2 gap-3">
        <span className="h-10 rounded-xl bg-[#1769df]/8" />
        <span className="h-10 rounded-xl bg-[#21c5be]/10" />
      </div>
    );
  }

  if (index === 3) {
    return (
      <div aria-hidden="true" className="mt-auto flex items-center gap-3">
        {["var(--trigger)", "var(--clickhouse)", "var(--arrow)", "var(--rust)"].map((color) => (
          <span className="h-1.5 flex-1 rounded-full" key={color} style={{ background: color }} />
        ))}
      </div>
    );
  }

  return (
    <div aria-hidden="true" className="mt-auto grid grid-cols-2 gap-3">
      <span className="h-9 rounded-xl border border-[#885cf6]/15 bg-[#885cf6]/8" />
      <span className="h-9 rounded-xl border border-[#21c5be]/15 bg-[#21c5be]/8" />
    </div>
  );
}

export function DashboardAssembly({ settling }: DashboardAssemblyProps) {
  return (
    <section
      aria-label={settling ? "Placing the completed dashboard" : "Building the dashboard"}
      aria-live="polite"
      className={`assembly-stage ${settling ? "is-settling" : ""}`}
    >
      <div className="absolute bottom-4 left-1/2 z-10 flex w-max max-w-[calc(100%-2rem)] -translate-x-1/2 items-center gap-3 rounded-2xl border border-white/90 bg-white/78 px-4 py-2.5 shadow-[0_14px_32px_rgb(45_57_84_/_9%)] backdrop-blur-xl">
        <BrandMark size={34} />
        <div>
          <p className="text-sm font-semibold tracking-[-0.02em] text-[var(--ink)]">
            {settling ? "Bringing it into focus" : "Building your answer"}
          </p>
          <div className="mt-1.5 flex items-center gap-1.5">
            {[
              "var(--trigger)",
              "var(--clickhouse)",
              "var(--arrow)",
              "var(--rust)",
            ].map((colour) => (
              <span
                className="size-1.5 rounded-full"
                key={colour}
                style={{ background: colour }}
              />
            ))}
          </div>
        </div>
      </div>
      {TILES.map(([label, detail], index) => (
        <div aria-hidden="true" className={`assembly-tile assembly-tile-${index + 1} flex flex-col`} key={label}>
          <span className="text-xs font-semibold text-[var(--ink)]">{label}</span>
          <span className="mt-1 block text-[11px] text-[var(--ink-tertiary)]">{detail}</span>
          <TilePreview index={index} />
        </div>
      ))}
    </section>
  );
}
