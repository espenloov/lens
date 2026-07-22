import { errAsync, okAsync, ResultAsync } from "neverthrow";
import { z } from "zod";

import { getPostgresClient } from "@/lib/postgres/client";

import {
  queryStrategySchema,
  type QueryStrategy,
} from "./contracts";

const activeRecipeRowsSchema = z.array(
  z.object({
    strategy: queryStrategySchema,
  }),
);

export type RecipeRegistryError = {
  readonly type: "recipe_registry_error";
  readonly message: string;
  readonly cause: unknown;
};

export type RecipePromotion = {
  readonly signature: string;
  readonly strategy: QueryStrategy;
  readonly fingerprint: string;
  readonly serverElapsedMs: number;
};

function toRegistryError(cause: unknown): RecipeRegistryError {
  return {
    type: "recipe_registry_error",
    message:
      cause instanceof Error
        ? cause.message
        : "The query recipe registry is unavailable",
    cause,
  };
}

export function getActiveRecipe(
  signature: string,
): ResultAsync<QueryStrategy | null, RecipeRegistryError> {
  const sql = getPostgresClient();

  if (sql === null) {
    return okAsync(null);
  }

  return ResultAsync.fromPromise(
    sql`
      SELECT versions.strategy
      FROM active_query_recipes AS active
      INNER JOIN query_recipe_versions AS versions
        ON versions.analysis_signature = active.analysis_signature
       AND versions.version = active.version
      WHERE active.analysis_signature = ${signature}
      LIMIT 1
    `,
    toRegistryError,
  ).andThen((rows) => {
    const parsed = activeRecipeRowsSchema.safeParse(rows);

    if (!parsed.success) {
      return errAsync(toRegistryError(parsed.error));
    }

    return okAsync(parsed.data[0]?.strategy ?? null);
  });
}

export function promoteRecipe(
  promotion: RecipePromotion,
): ResultAsync<boolean, RecipeRegistryError> {
  const sql = getPostgresClient();

  if (sql === null) {
    return okAsync(false);
  }

  return ResultAsync.fromPromise(
    sql.begin(async (transaction) => {
      await transaction`
        SELECT pg_advisory_xact_lock(hashtext(${promotion.signature}))
      `;

      const versions = await transaction<{ next_version: number }[]>`
        SELECT COALESCE(MAX(version), 0) + 1 AS next_version
        FROM query_recipe_versions
        WHERE analysis_signature = ${promotion.signature}
      `;
      const version = Number(versions[0]?.next_version ?? 1);

      await transaction`
        INSERT INTO query_recipe_versions
          (analysis_signature, version, strategy, fingerprint, server_elapsed_ms)
        VALUES
          (${promotion.signature}, ${version}, ${promotion.strategy},
           ${promotion.fingerprint}, ${promotion.serverElapsedMs})
      `;

      await transaction`
        INSERT INTO active_query_recipes
          (analysis_signature, version, activated_at)
        VALUES (${promotion.signature}, ${version}, NOW())
        ON CONFLICT (analysis_signature)
        DO UPDATE SET version = EXCLUDED.version, activated_at = NOW()
      `;
    }),
    toRegistryError,
  ).map(() => true);
}
