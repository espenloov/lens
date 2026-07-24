"use client";

import { MapPin } from "lucide-react";

import { LocationMap } from "@/components/ui/location-map";
import type { TrustedLocation } from "@/lib/geography/trusted-locations";

type GeographicContextCardProps = {
  readonly locations: readonly TrustedLocation[];
  readonly selectedKey: string | null;
  readonly onSelect: (key: string) => void;
};

export function GeographicContextCard({
  locations,
  selectedKey,
  onSelect,
}: GeographicContextCardProps) {
  const selected =
    locations.find((location) => location.key === selectedKey) ?? locations[0];

  return (
    <section className="analysis-tile relative min-h-40 overflow-hidden">
      <LocationMap
        className="absolute inset-0"
        onSelect={onSelect}
        points={locations}
        selectedKey={selected?.key ?? null}
      />
      <div className="pointer-events-none relative flex h-full min-h-40 flex-col justify-between p-4">
        <span className="flex w-fit items-center gap-1.5 rounded-full border border-white/80 bg-white/72 px-2.5 py-1 text-[10px] font-semibold text-[var(--ink-secondary)] shadow-sm backdrop-blur-xl">
          <MapPin aria-hidden="true" className="size-3 text-[#697cc7]" />
          Place in focus
        </span>
        <div className="w-fit rounded-xl bg-white/78 px-3 py-2 shadow-[0_8px_24px_rgb(45_57_84_/_10%)] backdrop-blur-xl">
          <p className="text-xl font-semibold tracking-[-0.035em] text-[var(--ink)]">
            {selected?.label}
          </p>
          <p className="mt-1 text-xs text-[var(--ink-tertiary)]">
            {locations.length === 1
              ? "The answer is filtered to this place"
              : `${locations.length} places · select one to focus`}
          </p>
        </div>
      </div>
    </section>
  );
}
