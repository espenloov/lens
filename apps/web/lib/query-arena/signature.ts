import { createHash } from "node:crypto";

import type { TimeSeriesRequest } from "../time-series/contracts";

export function normalizeTimeSeriesRequest(request: TimeSeriesRequest) {
  return {
    metric: request.metric,
    interval: request.interval,
    dateFrom: request.dateFrom,
    dateTo: request.dateTo,
    location: {
      level: request.location.level,
      values: request.location.values
        .map((value) => value.trim().toUpperCase())
        .sort(),
    },
    propertyTypes: [...request.propertyTypes].sort(),
  };
}

export function createAnalysisSignature(request: TimeSeriesRequest): string {
  return createHash("sha256")
    .update(JSON.stringify(normalizeTimeSeriesRequest(request)))
    .digest("hex");
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
