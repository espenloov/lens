import { z } from "zod";

import {
  clickHouseIdentifierSchema,
  datasetSlugSchema,
  type AnalysisDataSource,
} from "../../data-sources/contracts";

const allowlistEntrySchema = z.object({
  dataset: datasetSlugSchema,
  version: z.number().int().positive(),
  database: clickHouseIdentifierSchema,
  table: clickHouseIdentifierSchema,
});

export type TuningEligibility = {
  readonly eligible: boolean;
  readonly managed: boolean;
  readonly writable: boolean;
  readonly executionEnabled: boolean;
  readonly reason: string;
};

function parseEntry(raw: string) {
  const match = raw.match(
    /^([a-z][a-z0-9]*(?:_[a-z0-9]+)*)@([1-9][0-9]*):([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*)$/,
  );

  if (match === null) {
    return null;
  }

  const parsed = allowlistEntrySchema.safeParse({
    dataset: match[1],
    version: Number(match[2]),
    database: match[3],
    table: match[4],
  });

  return parsed.success ? parsed.data : null;
}

export function parseTunableDataSources(
  value: string | undefined,
): readonly z.infer<typeof allowlistEntrySchema>[] {
  if (value === undefined || value.trim() === "") {
    return [];
  }

  const entries = value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  const parsed = entries.map(parseEntry);

  return parsed.some((entry) => entry === null)
    ? []
    : parsed.flatMap((entry) => (entry === null ? [] : [entry]));
}

export function evaluateTuningEligibility(
  source: AnalysisDataSource,
  environment: {
    readonly allowlist?: string;
    readonly executionEnabled?: string;
  } = {
    allowlist: process.env.LENS_TUNABLE_DATA_SOURCES,
    executionEnabled: process.env.LENS_TUNING_EXECUTION_ENABLED,
  },
): TuningEligibility {
  const allowlist = parseTunableDataSources(environment.allowlist);
  const matched = allowlist.some(
    (entry) =>
      entry.dataset === source.slug &&
      entry.version === source.version &&
      entry.database === source.database &&
      entry.table === source.table,
  );
  const executionEnabled = environment.executionEnabled === "true";

  if (!matched) {
    return {
      eligible: false,
      managed: false,
      writable: false,
      executionEnabled,
      reason:
        "This exact dataset version and ClickHouse table is not in LENS_TUNABLE_DATA_SOURCES",
    };
  }

  if (!executionEnabled) {
    return {
      eligible: true,
      managed: true,
      writable: true,
      executionEnabled: false,
      reason:
        "Proposals and approvals are enabled, but physical execution is disabled",
    };
  }

  return {
    eligible: true,
    managed: true,
    writable: true,
    executionEnabled: true,
    reason: "This source is explicitly managed, writable, and execution-enabled",
  };
}
