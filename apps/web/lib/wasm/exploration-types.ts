export type ExplorationFilters = readonly [number | null, number | null, number | null];

export type ExplorationSummary = {
  readonly totalCount: number;
  readonly averageValue: number;
  readonly q1: number;
  readonly median: number;
  readonly q3: number;
  readonly estimatedOutlierCount: number;
  readonly histogramCounts: Uint32Array;
  readonly dimensionCounts: readonly [Uint32Array, Uint32Array, Uint32Array];
};

export type ExplorationFrame = {
  readonly densityCounts: Uint32Array;
  readonly dailyQuartiles: Float64Array;
};

export type ExplorationWorkspaceMetadata = {
  readonly rowCount: number;
  readonly dayCount: number;
  readonly binCount: number;
  readonly indexBytes: number;
  readonly bucketMinimum: number;
  readonly bucketWidth: number;
};

export type ExplorationWorkerLoadResult = {
  readonly metadata: ExplorationWorkspaceMetadata;
  readonly frame: ExplorationFrame;
  readonly summary: ExplorationSummary;
  readonly wasmStartupMs: number;
  readonly rustBuildMs: number;
  readonly rustQueryMs: number;
};

export type ExplorationWorkerQueryResult = {
  readonly frame: ExplorationFrame | null;
  readonly summary: ExplorationSummary;
  readonly rustQueryMs: number;
};

export type ExplorationWorkerRequest =
  | {
      readonly id: number;
      readonly type: "load";
      readonly bytes: ArrayBuffer;
      readonly dayCount: number;
      readonly binCount: number;
      readonly bucketMinimum: number;
      readonly bucketWidth: number;
      readonly cardinalities: readonly [number, number, number];
    }
  | {
      readonly id: number;
      readonly type: "query";
      readonly startDay: number;
      readonly endDay: number;
      readonly filters: ExplorationFilters;
      readonly includeDensity: boolean;
    };

export type ExplorationWorkerResponse =
  | {
      readonly id: number;
      readonly ok: true;
      readonly result: ExplorationWorkerLoadResult | ExplorationWorkerQueryResult;
    }
  | {
      readonly id: number;
      readonly ok: false;
      readonly error: string;
    };
