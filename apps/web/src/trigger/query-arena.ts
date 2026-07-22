import { logger, metadata, schemaTask } from "@trigger.dev/sdk";
import { z } from "zod";

import {
  queryArenaResultSchema,
  queryStrategySchema,
  strategyBenchmarkSchema,
  type QueryStrategy,
  type StrategyBenchmark,
} from "@/lib/query-arena/contracts";
import { benchmarkQueryStrategy } from "@/lib/query-arena/benchmark";
import {
  appendPerformanceHistory,
  toPerformanceHistoryRows,
} from "@/lib/query-arena/history";
import { promoteRecipe } from "@/lib/query-arena/recipe-registry";
import { evaluateQueryArena, benchmarkTime } from "@/lib/query-arena/result";
import { timeSeriesRequestSchema } from "@/lib/time-series/contracts";

const STRATEGIES = queryStrategySchema.options;
const TRIAL_COUNT = 3;

const queryArenaPayloadSchema = z.object({
  arenaId: z.uuid(),
  signature: z.string().regex(/^[a-f0-9]{64}$/),
  request: timeSeriesRequestSchema,
});

async function runStrategy(
  request: z.infer<typeof timeSeriesRequestSchema>,
  strategy: QueryStrategy,
): Promise<StrategyBenchmark> {
  const trials = [];

  for (let trial = 0; trial < TRIAL_COUNT; trial += 1) {
    const benchmark = await benchmarkQueryStrategy(request, strategy);

    if (benchmark.isErr()) {
      throw new Error(benchmark.error.message, {
        cause: benchmark.error.cause,
      });
    }

    trials.push(benchmark.value);
  }

  const [reference, ...remaining] = trials;
  const fingerprintsMatch = remaining.every(
    (trial) =>
      trial.fingerprint.digest === reference.fingerprint.digest &&
      trial.fingerprint.rowCount === reference.fingerprint.rowCount,
  );

  if (!fingerprintsMatch) {
    throw new Error("Repeated trials returned different Rust fingerprints");
  }

  const rankedTrials = [...trials].sort(
    (left, right) =>
      (left.metrics.serverElapsedMs ?? left.metrics.roundTripMs) -
      (right.metrics.serverElapsedMs ?? right.metrics.roundTripMs),
  );
  const output = strategyBenchmarkSchema.parse({
    strategy,
    trials,
    medianMetrics: rankedTrials[1].metrics,
    fingerprint: reference.fingerprint,
  });

  await metadata
    .append("candidateEvents", {
      strategy,
      status: "completed",
      medianMs:
        output.medianMetrics.serverElapsedMs ??
        output.medianMetrics.roundTripMs,
    })
    .increment("completedCandidates", 1)
    .increment("progress", 0.25)
    .flush();

  logger.info("Query Arena strategy completed", {
    strategy,
    medianMs:
      output.medianMetrics.serverElapsedMs ??
      output.medianMetrics.roundTripMs,
    rowsRead: output.medianMetrics.rowsRead,
    fingerprint: output.fingerprint.digest,
  });

  return output;
}

export const queryArenaTask = schemaTask({
  id: "query-arena",
  schema: queryArenaPayloadSchema,
  maxDuration: 120,
  retry: {
    maxAttempts: 1,
  },

  run: async ({ arenaId, signature, request }) => {
    await metadata
      .set("phase", "racing")
      .set("progress", 0.2)
      .set("strategies", STRATEGIES)
      .set("completedCandidates", 0)
      .set("candidateEvents", [])
      .flush();

    const outcomes = await Promise.all(
      STRATEGIES.map(async (strategy) => {
        try {
          return {
            ok: true as const,
            output: await runStrategy(request, strategy),
          };
        } catch (error) {
          await metadata
            .append("candidateEvents", {
              strategy,
              status: "failed",
              medianMs: null,
            })
            .increment("completedCandidates", 1)
            .increment("progress", 0.25)
            .flush();

          logger.error("Query Arena strategy failed", { strategy, error });

          return { ok: false as const, error };
        }
      }),
    );

    await metadata.set("phase", "verifying").set("progress", 0.75).flush();

    const evaluation = evaluateQueryArena(STRATEGIES, outcomes);
    const { candidates, verified, winner, speedup, winnerBenchmark } =
      evaluation;
    const completedAt = new Date().toISOString();

    await metadata.set("phase", "persisting").set("progress", 0.85).flush();

    const history = await appendPerformanceHistory(
      toPerformanceHistoryRows({
        arenaId,
        signature,
        candidates,
        winner,
        recordedAt: completedAt,
      }),
    );
    const recipe =
      winnerBenchmark === null
        ? null
        : await promoteRecipe({
            signature,
            strategy: winnerBenchmark.strategy,
            fingerprint: winnerBenchmark.fingerprint.digest,
            serverElapsedMs: benchmarkTime(winnerBenchmark),
          });
    const result = queryArenaResultSchema.parse({
      arenaId,
      signature,
      baselineStrategy: "baseline",
      candidates,
      winner,
      verified,
      speedup,
      historyStored: history.isOk() && history.value,
      recipeStored: recipe?.isOk() === true && recipe.value,
      completedAt,
    });

    if (history.isErr()) {
      logger.warn("Query Arena history was not stored", {
        message: history.error.message,
      });
    }

    if (recipe?.isErr()) {
      logger.warn("Query Arena recipe was not stored", {
        message: recipe.error.message,
      });
    }

    await metadata.set("phase", "completed").set("progress", 1).flush();

    return result;
  },
});
