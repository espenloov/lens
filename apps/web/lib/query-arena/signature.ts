import { createHash } from "node:crypto";

import type { TimeSeriesRequest } from "../time-series/contracts";
import { queryArenaTimeSeriesRequestSchema } from "../time-series/contracts";
import {
  queryArenaRequestSchema,
  type QueryArenaRequest,
} from "./contracts";

export function normalizeTimeSeriesRequest(request: TimeSeriesRequest) {
  return {
    schemaVersion: 3,
    dataset: request.dataset,
    datasetVersion: request.datasetVersion ?? 1,
    shape: request.shape,
    operation: request.operation,
    metric: request.metric,
    interval: request.interval,
    seriesBy: request.seriesBy,
    transform: request.transform,
    anomalyThreshold: request.anomalyThreshold,
    filters: {
      ...request.filters,
      location:
        request.filters.location === null
          ? null
          : {
              level: request.filters.location.level,
              values: request.filters.location.values
                .map((value) => value.trim().toUpperCase())
                .sort(),
            },
      propertyTypes: [...request.filters.propertyTypes].sort(),
      tenure: [...request.filters.tenure].sort(),
    },
  };
}

export function createArenaId(
  signature: string,
  now: Date = new Date(),
): string {
  const hour = now.toISOString().slice(0, 13);
  const bytes = createHash("sha256")
    .update(`${signature}:${hour}`)
    .digest()
    .subarray(0, 16);

  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function createAnalysisSignature(request: TimeSeriesRequest): string {
  return createHash("sha256")
    .update(JSON.stringify(normalizeTimeSeriesRequest(request)))
    .digest("hex");
}

export function supportsQueryArena(request: TimeSeriesRequest): boolean {
  return queryArenaTimeSeriesRequestSchema.safeParse(request).success;
}

function normalizeSemanticAnalysis(
  analysis: Extract<QueryArenaRequest, { kind: "semantic" }>,
) {
  const plan = {
    ...analysis.request.plan,
    title: "",
    explanation: "",
  };

  return {
    schemaVersion: 4,
    kind: analysis.kind,
    request: {
      shape: analysis.request.shape,
      transform: analysis.request.transform,
      plan: {
        ...plan,
        filters: {
          timeRange: plan.filters.timeRange,
          dimensions: [...plan.filters.dimensions]
            .map((filter) => ({
              dimension: filter.dimension,
              values: [...filter.values].sort((left, right) =>
                String(left).localeCompare(String(right)),
              ),
            }))
            .sort((left, right) =>
              left.dimension.localeCompare(right.dimension),
            ),
          measures: [...plan.filters.measures].sort((left, right) =>
            left.measure.localeCompare(right.measure),
          ),
        },
      },
    },
  };
}

export function normalizeQueryArenaRequest(analysis: QueryArenaRequest) {
  return analysis.kind === "time_series"
    ? {
        schemaVersion: 4,
        kind: analysis.kind,
        request: normalizeTimeSeriesRequest(analysis.request),
      }
    : normalizeSemanticAnalysis(analysis);
}

export function createQueryArenaSignature(
  analysis: QueryArenaRequest,
): string {
  const validated = queryArenaRequestSchema.parse(analysis);

  return createHash("sha256")
    .update(JSON.stringify(normalizeQueryArenaRequest(validated)))
    .digest("hex");
}
