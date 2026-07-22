import type { CompactDimension } from "./contracts";
import type { ExplorationRequest } from "./execution";

export type ExplorationCode = {
  readonly code: number;
  readonly label: string;
};

export type ExplorationDimensionMetadata = {
  readonly key: CompactDimension | null;
  readonly label: string;
  readonly values: readonly ExplorationCode[];
};

const CODEBOOKS: Record<
  CompactDimension,
  Omit<ExplorationDimensionMetadata, "key">
> = {
  property_type: {
    label: "Property type",
    values: [
      { code: 0, label: "Detached" },
      { code: 1, label: "Semi-detached" },
      { code: 2, label: "Terraced" },
      { code: 3, label: "Flat" },
      { code: 4, label: "Other" },
    ],
  },
  tenure: {
    label: "Tenure",
    values: [
      { code: 0, label: "Freehold" },
      { code: 1, label: "Leasehold" },
      { code: 2, label: "Unknown" },
    ],
  },
  new_build: {
    label: "Build status",
    values: [
      { code: 0, label: "Existing" },
      { code: 1, label: "New build" },
    ],
  },
};

const UNUSED_DIMENSION: ExplorationDimensionMetadata = {
  key: null,
  label: "All transactions",
  values: [{ code: 0, label: "All" }],
};

export function explorationDimensions(
  request: ExplorationRequest,
): readonly [
  ExplorationDimensionMetadata,
  ExplorationDimensionMetadata,
  ExplorationDimensionMetadata,
] {
  return [0, 1, 2].map((index) => {
    const key = request.dimensions[index];

    return key === undefined ? UNUSED_DIMENSION : { key, ...CODEBOOKS[key] };
  }) as [
    ExplorationDimensionMetadata,
    ExplorationDimensionMetadata,
    ExplorationDimensionMetadata,
  ];
}

export function explorationDayCount(request: ExplorationRequest): number {
  const start = Date.parse(`${request.filters.dateFrom}T00:00:00Z`);
  const end = Date.parse(`${request.filters.dateTo}T00:00:00Z`);

  return Math.floor((end - start) / 86_400_000) + 1;
}

export function explorationDateAt(
  request: ExplorationRequest,
  dayIndex: number,
): Date {
  const start = Date.parse(`${request.filters.dateFrom}T00:00:00Z`);

  return new Date(start + dayIndex * 86_400_000);
}
