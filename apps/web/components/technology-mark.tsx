import Image from "next/image";

type Technology = "clickhouse" | "postgres" | "rust" | "trigger" | "wasm";

const TECHNOLOGIES: Record<
  Technology,
  { readonly alt: string; readonly src: string }
> = {
  clickhouse: {
    alt: "ClickHouse",
    src: "/clickhouse-yellow-badge.svg",
  },
  postgres: {
    alt: "PostgreSQL",
    src: "/PostgreSQL-Logo.png",
  },
  rust: {
    alt: "Rust",
    src: "/rust_logo.webp",
  },
  trigger: {
    alt: "Trigger.dev",
    src: "/triggerdotdev_logo.jpeg",
  },
  wasm: {
    alt: "WebAssembly",
    src: "/wasm_logo.png",
  },
};

export function TechnologyMark({
  className = "",
  technology,
}: {
  readonly className?: string;
  readonly technology: Technology;
}) {
  const item = TECHNOLOGIES[technology];

  return (
    <span
      className={`grid size-9 shrink-0 place-items-center overflow-hidden rounded-xl border border-white/80 bg-white shadow-[0_8px_18px_rgb(45_57_84_/_9%)] ${className}`}
    >
      <Image
        alt={item.alt}
        className="size-7 object-contain"
        height={28}
        src={item.src}
        width={28}
      />
    </span>
  );
}
