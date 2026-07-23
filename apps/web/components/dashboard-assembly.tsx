type DashboardAssemblyProps = {
  readonly settling: boolean;
};

const TILES = [
  ["ClickHouse is shaping the result", "Hero visualization"],
  ["Agent is checking the finding", "Key insight"],
  ["Rust is typing the values", "Selected comparison"],
  ["Arrow is streaming", "Execution evidence"],
  ["Trigger.dev is verifying", "Performance proof"],
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
      <div className="absolute bottom-4 left-1/2 z-10 w-max max-w-[calc(100%-2rem)] -translate-x-1/2 rounded-xl border border-white/90 bg-white/80 px-4 py-2.5 text-center shadow-sm backdrop-blur-xl">
        <p className="text-sm font-medium text-[#09265b]">
          {settling ? "Placing your dashboard" : "Building your analytical workspace"}
        </p>
        <p className="mt-2 text-xs text-[#66758e]">
          {settling ? "The result is ready." : "Each tile is computed from the same validated plan."}
        </p>
      </div>
      {TILES.map(([label, detail], index) => (
        <div aria-hidden="true" className={`assembly-tile assembly-tile-${index + 1} flex flex-col`} key={label}>
          <span className="text-xs font-semibold text-[#09265b]">{label}</span>
          <span className="mt-1 block text-xs text-[#66758e]">{detail}</span>
          <TilePreview index={index} />
        </div>
      ))}
    </section>
  );
}
