import { logger, metadata, schemaTask } from "@trigger.dev/sdk";
import { z } from "zod";

import {
  queryArenaLearningSourceSchema,
  queryArenaResultSchema,
  queryArenaRequestSchema,
  queryStrategySchema,
  strategyBenchmarkSchema,
  type QueryBenchmarkTrial,
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

const STRATEGIES = queryStrategySchema.options;
const TRIAL_COUNT = 3;

const queryArenaPayloadSchema = z.object({
  arenaId: z.uuid(),
  signature: z.string().regex(/^[a-f0-9]{64}$/),
  semanticFamilyHash: z.string().regex(/^[a-f0-9]{64}$/),
  learningSource: queryArenaLearningSourceSchema,
  priorStrategy: queryStrategySchema.nullable(),
  priorEvidenceCount: z.number().int().nonnegative(),
  analysis: queryArenaRequestSchema,
});

function orderedStrategies(
  priorStrategy: QueryStrategy | null,
): QueryStrategy[] {
  return priorStrategy === null
    ? [...STRATEGIES]
    : [
        priorStrategy,
        ...STRATEGIES.filter((strategy) => strategy !== priorStrategy),
      ];
}

function analysisDataset(
  analysis: z.infer<typeof queryArenaRequestSchema>,
): { readonly dataset: string; readonly datasetVersion: number } {
  return analysis.kind === "semantic"
    ? {
        dataset: analysis.request.plan.dataset,
        datasetVersion: analysis.request.plan.datasetVersion,
      }
    : {
        dataset: analysis.request.dataset,
        datasetVersion: analysis.request.datasetVersion ?? 1,
      };
}

async function measureTrial(
  analysis: z.infer<typeof queryArenaRequestSchema>,
  strategy: QueryStrategy,
  trial: number,
): Promise<QueryBenchmarkTrial> {
  const benchmark = await benchmarkQueryStrategy(analysis, strategy);

  if (benchmark.isErr()) {
    throw new Error(benchmark.error.message, {
      cause: benchmark.error.cause,
    });
  }

  await metadata
    .append("trialEvents", {
      strategy,
      trial,
      durationMs:
        benchmark.value.metrics.serverElapsedMs ??
        benchmark.value.metrics.roundTripMs,
    })
    .increment("progress", 0.075)
    .flush();

  return benchmark.value;
}

function finalizeStrategy(
  strategy: QueryStrategy,
  trials: readonly QueryBenchmarkTrial[],
): StrategyBenchmark {
  const [reference, ...remaining] = trials;

  if (reference === undefined || trials.length !== TRIAL_COUNT) {
    throw new Error("The strategy did not complete every measured pass");
  }

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

  return output;
}

async function runStrategies(
  analysis: z.infer<typeof queryArenaRequestSchema>,
  strategies: readonly QueryStrategy[],
) {
  const states = strategies.map((strategy) => ({
    strategy,
    trials: [] as QueryBenchmarkTrial[],
    error: null as unknown,
  }));

  for (let trial = 0; trial < TRIAL_COUNT; trial += 1) {
    const passOrder =
      trial % 2 === 0 ? states : [...states].reverse();

    for (const state of passOrder) {
      if (state.error !== null) {
        continue;
      }

      try {
        state.trials.push(
          await measureTrial(analysis, state.strategy, trial),
        );
      } catch (error) {
        state.error = error;
      }
    }
  }

  return await Promise.all(
    states.map(async (state) => {
      try {
        if (state.error !== null) {
          throw state.error;
        }

        const output = finalizeStrategy(state.strategy, state.trials);

        await metadata
          .append("candidateEvents", {
            strategy: state.strategy,
            status: "completed",
            medianMs:
              output.medianMetrics.serverElapsedMs ??
              output.medianMetrics.roundTripMs,
          })
          .increment("completedCandidates", 1)
          .increment("progress", 0.05)
          .flush();

        logger.info("Query Arena strategy completed", {
          strategy: state.strategy,
          medianMs:
            output.medianMetrics.serverElapsedMs ??
            output.medianMetrics.roundTripMs,
          rowsRead: output.medianMetrics.rowsRead,
          fingerprint: output.fingerprint.digest,
        });

        return {
          ok: true as const,
          output,
        };
      } catch (error) {
        await metadata
          .append("candidateEvents", {
            strategy: state.strategy,
            status: "failed",
            medianMs: null,
          })
          .increment("completedCandidates", 1)
          .increment("progress", 0.05)
          .flush();

        logger.error("Query Arena strategy failed", {
          strategy: state.strategy,
          error,
        });

        return { ok: false as const, error };
      }
    }),
  );
}

export const queryArenaTask = schemaTask({
  id: "query-arena",
  schema: queryArenaPayloadSchema,
  maxDuration: 120,
  retry: {
    maxAttempts: 1,
  },

  run: async ({
    analysis,
    arenaId,
    signature,
    semanticFamilyHash,
    learningSource,
    priorStrategy,
    priorEvidenceCount,
  }) => {
    const strategies = orderedStrategies(priorStrategy);
    const source = analysisDataset(analysis);

    await metadata
      .set("phase", "racing")
      .set("progress", 0.2)
      .set("strategies", strategies)
      .set("learningSource", learningSource)
      .set("priorStrategy", priorStrategy)
      .set("priorEvidenceCount", priorEvidenceCount)
      .set("completedCandidates", 0)
      .set("trialEvents", [])
      .set("candidateEvents", [])
      .flush();

    const outcomes = await runStrategies(analysis, strategies);

    await metadata.set("phase", "verifying").set("progress", 0.75).flush();

    const evaluation = evaluateQueryArena(strategies, outcomes);
    const { candidates, verified, winner, speedup, winnerBenchmark } =
      evaluation;
    const completedAt = new Date().toISOString();

    await metadata.set("phase", "persisting").set("progress", 0.85).flush();

    const history = await appendPerformanceHistory(
      toPerformanceHistoryRows({
        arenaId,
        signature,
        semanticFamilyHash,
        dataset: source.dataset,
        datasetVersion: source.datasetVersion,
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
            semanticFamilyHash,
            strategy: winnerBenchmark.strategy,
            fingerprint: winnerBenchmark.fingerprint.digest,
            serverElapsedMs: benchmarkTime(winnerBenchmark),
          });
    const result = queryArenaResultSchema.parse({
      arenaId,
      signature,
      semanticFamilyHash,
      learningSource,
      priorStrategy,
      priorEvidenceCount,
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
