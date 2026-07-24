import { z } from "zod";

import { getClickHouseClient } from "../clickhouse/client";
import { getPostgresClient } from "../postgres/client";

import { queryStrategySchema, type QueryStrategy } from "./contracts";

const performanceLaneRowsSchema = z.array(
  z.object({
    arena_id: z.string().min(1),
    strategy: queryStrategySchema,
    winner: z.union([z.literal(0), z.literal(1), z.boolean()]),
    median_ms: z.coerce.number().nonnegative(),
    result_fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    fingerprint_count: z.coerce.number().int().positive(),
  }),
);

const registryIntelligenceRowsSchema = z.array(
  z.object({
    recipe_activations: z.coerce.number().int().nonnegative(),
    semantic_families: z.coerce.number().int().nonnegative(),
    exact_hits: z.coerce.number().int().nonnegative(),
    exact_misses: z.coerce.number().int().nonnegative(),
    prior_suggestions: z.coerce.number().int().nonnegative(),
  }),
);

export type PerformanceLane = {
  readonly arenaId: string;
  readonly strategy: QueryStrategy;
  readonly winner: boolean;
  readonly medianMs: number;
  readonly fingerprint: string;
  readonly fingerprintCount: number;
};

export type PerformanceIntelligence = {
  readonly verifiedRaces: number;
  readonly baselineP50Ms: number | null;
  readonly baselineP95Ms: number | null;
  readonly winnerP50Ms: number | null;
  readonly winnerP95Ms: number | null;
  readonly accumulatedServerMsSaved: number;
};

export type SystemIntelligence = PerformanceIntelligence & {
  readonly available: boolean;
  readonly clickHouseAvailable: boolean;
  readonly registryAvailable: boolean;
  readonly recipeActivations: number;
  readonly semanticFamilies: number;
  readonly exactHits: number;
  readonly priorSuggestions: number;
  readonly exactHitRate: number | null;
};

const emptyPerformance: PerformanceIntelligence = {
  verifiedRaces: 0,
  baselineP50Ms: null,
  baselineP95Ms: null,
  winnerP50Ms: null,
  winnerP95Ms: null,
  accumulatedServerMsSaved: 0,
};

function percentile(values: readonly number[], quantile: number): number | null {
  if (values.length === 0) {
    return null;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const position = (sorted.length - 1) * quantile;
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.ceil(position);
  const lower = sorted[lowerIndex]!;
  const upper = sorted[upperIndex]!;

  return lower + (upper - lower) * (position - lowerIndex);
}

export function summarizePerformanceLanes(
  lanes: readonly PerformanceLane[],
): PerformanceIntelligence {
  const races = new Map<string, PerformanceLane[]>();

  for (const lane of lanes) {
    const race = races.get(lane.arenaId) ?? [];
    race.push(lane);
    races.set(lane.arenaId, race);
  }

  const verified = [...races.values()].filter((race) => {
    const strategies = new Set(race.map((lane) => lane.strategy));
    const fingerprints = new Set(race.map((lane) => lane.fingerprint));

    return (
      strategies.size >= 2 &&
      fingerprints.size === 1 &&
      race.every((lane) => lane.fingerprintCount === 1)
    );
  });
  const baselineTimes: number[] = [];
  const winnerTimes: number[] = [];
  let accumulatedServerMsSaved = 0;

  for (const race of verified) {
    const baseline = race.find((lane) => lane.strategy === "baseline");
    const winner = race.find((lane) => lane.winner);

    if (baseline === undefined || winner === undefined) {
      continue;
    }

    baselineTimes.push(baseline.medianMs);
    winnerTimes.push(winner.medianMs);
    accumulatedServerMsSaved += Math.max(
      0,
      baseline.medianMs - winner.medianMs,
    );
  }

  return {
    verifiedRaces: verified.length,
    baselineP50Ms: percentile(baselineTimes, 0.5),
    baselineP95Ms: percentile(baselineTimes, 0.95),
    winnerP50Ms: percentile(winnerTimes, 0.5),
    winnerP95Ms: percentile(winnerTimes, 0.95),
    accumulatedServerMsSaved,
  };
}

async function loadPerformanceIntelligence(): Promise<PerformanceIntelligence> {
  const resultSet = await getClickHouseClient().query({
    query: `
      SELECT
        toString(arena_id) AS arena_id,
        strategy,
        toUInt8(winner) AS winner,
        median(coalesce(server_elapsed_ms, round_trip_ms)) AS median_ms,
        toString(any(assumeNotNull(fingerprint))) AS result_fingerprint,
        uniqExact(fingerprint) AS fingerprint_count
      FROM query_arena_performance_history
      WHERE outcome = 'verified'
        AND fingerprint IS NOT NULL
        AND (server_elapsed_ms IS NOT NULL OR round_trip_ms IS NOT NULL)
      GROUP BY arena_id, strategy, winner
      ORDER BY arena_id, strategy
    `,
    format: "JSONEachRow",
    clickhouse_settings: {
      max_execution_time: 5,
      max_result_rows: "10000",
      readonly: "1",
    },
  });
  const rows = performanceLaneRowsSchema.parse(
    await resultSet.json<unknown>(),
  );

  return summarizePerformanceLanes(
    rows.map((row) => ({
      arenaId: row.arena_id,
      strategy: row.strategy,
      winner: row.winner === true || row.winner === 1,
      medianMs: row.median_ms,
      fingerprint: row.result_fingerprint,
      fingerprintCount: row.fingerprint_count,
    })),
  );
}

async function loadRegistryIntelligence() {
  const sql = getPostgresClient();

  if (sql === null) {
    return null;
  }

  const rows = registryIntelligenceRowsSchema.parse(await sql`
    SELECT
      (SELECT COUNT(*) FROM query_recipe_versions) AS recipe_activations,
      (
        SELECT COUNT(DISTINCT semantic_family_hash)
        FROM query_recipe_versions
        WHERE semantic_family_hash IS NOT NULL
      ) AS semantic_families,
      COUNT(*) FILTER (
        WHERE outcome = 'exact_hit'
      ) AS exact_hits,
      COUNT(*) FILTER (
        WHERE outcome = 'exact_miss'
      ) AS exact_misses,
      COUNT(*) FILTER (
        WHERE outcome = 'prior_available'
      ) AS prior_suggestions
    FROM query_recipe_lookup_events
  `);

  return rows[0] ?? null;
}

export async function getSystemIntelligence(): Promise<SystemIntelligence> {
  const [performance, registry] = await Promise.allSettled([
    loadPerformanceIntelligence(),
    loadRegistryIntelligence(),
  ]);
  const performanceAvailable = performance.status === "fulfilled";
  const registryValue =
    registry.status === "fulfilled" ? registry.value : null;
  const exactHits = registryValue?.exact_hits ?? 0;
  const exactMisses = registryValue?.exact_misses ?? 0;
  const priorSuggestions = registryValue?.prior_suggestions ?? 0;
  const lookups = exactHits + exactMisses + priorSuggestions;

  return {
    ...(performanceAvailable ? performance.value : emptyPerformance),
    available: performanceAvailable || registryValue !== null,
    clickHouseAvailable: performanceAvailable,
    registryAvailable: registryValue !== null,
    recipeActivations: registryValue?.recipe_activations ?? 0,
    semanticFamilies: registryValue?.semantic_families ?? 0,
    exactHits,
    priorSuggestions,
    exactHitRate: lookups === 0 ? null : exactHits / lookups,
  };
}
