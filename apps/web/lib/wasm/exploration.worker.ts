import initializeWasm, {
  build_exploration_workspace,
  type ExplorationWindow,
  type ExplorationWorkspace,
} from "./lens/lens_wasm";

import type {
  ExplorationFilters,
  ExplorationFrame,
  ExplorationSummary,
  ExplorationWorkerRequest,
  ExplorationWorkerResponse,
} from "./exploration-types";

let workspace: ExplorationWorkspace | null = null;
let initialization: Promise<unknown> | null = null;

function initialize() {
  initialization ??= initializeWasm();
  return initialization;
}

function filterCodes(filters: ExplorationFilters): [number, number, number] {
  return filters.map((filter) => filter ?? -1) as [number, number, number];
}

function readSummary(window: ExplorationWindow): ExplorationSummary {
  try {
    return {
      totalCount: window.total_count,
      averageValue: window.average_value,
      q1: window.q1,
      median: window.median,
      q3: window.q3,
      estimatedOutlierCount: window.estimated_outlier_count,
      histogramCounts: window.histogram_counts(),
      dimensionCounts: [
        window.dimension_counts(0),
        window.dimension_counts(1),
        window.dimension_counts(2),
      ],
    };
  } finally {
    window.free();
  }
}

function readFrame(filters: ExplorationFilters): ExplorationFrame {
  if (workspace === null) {
    throw new Error("The exploration workspace is not loaded");
  }

  const codes = filterCodes(filters);
  const frame = workspace.density_frame(...codes);

  try {
    return {
      densityCounts: frame.density_counts(),
      dailyQuartiles: frame.daily_quartiles(),
    };
  } finally {
    frame.free();
  }
}

function transferables(
  frame: ExplorationFrame | null,
  summary: ExplorationSummary,
): Transferable[] {
  return [
    ...(frame === null
      ? []
      : [frame.densityCounts.buffer, frame.dailyQuartiles.buffer]),
    summary.histogramCounts.buffer,
    ...summary.dimensionCounts.map((counts) => counts.buffer),
  ];
}

self.onmessage = async (event: MessageEvent<ExplorationWorkerRequest>) => {
  const request = event.data;

  try {
    if (request.type === "load") {
      const startupStartedAt = performance.now();
      await initialize();
      const wasmStartupMs = performance.now() - startupStartedAt;
      workspace?.free();
      const buildStartedAt = performance.now();
      workspace = build_exploration_workspace(
        new Uint8Array(request.bytes),
        request.dayCount,
        request.binCount,
        request.bucketMinimum,
        request.bucketWidth,
        ...request.cardinalities,
      );
      const rustBuildMs = performance.now() - buildStartedAt;
      const queryStartedAt = performance.now();
      const filters: ExplorationFilters = [null, null, null];
      const frame = readFrame(filters);
      const summary = readSummary(
        workspace.summarize(0, request.dayCount - 1, -1, -1, -1),
      );
      const rustQueryMs = performance.now() - queryStartedAt;
      const response: ExplorationWorkerResponse = {
        id: request.id,
        ok: true,
        result: {
          metadata: {
            rowCount: workspace.row_count,
            dayCount: workspace.day_count,
            binCount: workspace.bin_count,
            indexBytes: workspace.index_bytes,
            bucketMinimum: workspace.bucket_minimum,
            bucketWidth: workspace.bucket_width,
          },
          frame,
          summary,
          wasmStartupMs,
          rustBuildMs,
          rustQueryMs,
        },
      };
      self.postMessage(response, { transfer: transferables(frame, summary) });
      return;
    }

    if (workspace === null) {
      throw new Error("The exploration workspace is not loaded");
    }

    const queryStartedAt = performance.now();
    const codes = filterCodes(request.filters);
    const summary = readSummary(
      workspace.summarize(request.startDay, request.endDay, ...codes),
    );
    const frame = request.includeDensity ? readFrame(request.filters) : null;
    const response: ExplorationWorkerResponse = {
      id: request.id,
      ok: true,
      result: {
        frame,
        summary,
        rustQueryMs: performance.now() - queryStartedAt,
      },
    };
    self.postMessage(response, { transfer: transferables(frame, summary) });
  } catch (cause) {
    const response: ExplorationWorkerResponse = {
      id: request.id,
      ok: false,
      error: cause instanceof Error ? cause.message : String(cause),
    };
    self.postMessage(response);
  }
};
