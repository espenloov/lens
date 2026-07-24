import { errAsync, okAsync, ResultAsync } from "neverthrow";
import type { Sql } from "postgres";
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

const priorRecipeRowsSchema = z.array(
  z.object({
    strategy: queryStrategySchema,
    evidence_count: z.coerce.number().int().positive(),
    median_server_elapsed_ms: z.coerce.number().nonnegative(),
  }),
);

export type RecipeRegistryError = {
  readonly type: "recipe_registry_error";
  readonly message: string;
  readonly cause: unknown;
};

export type RecipePromotion = {
  readonly signature: string;
  readonly semanticFamilyHash?: string;
  readonly strategy: QueryStrategy;
  readonly fingerprint: string;
  readonly serverElapsedMs: number;
};

export type RecipeIdentity = {
  readonly executionSignature: string;
  readonly semanticFamilyHash: string;
};

export type RecipePrior = {
  readonly strategy: QueryStrategy;
  readonly evidenceCount: number;
  readonly medianServerElapsedMs: number;
};

export type RecipeGuidance =
  | {
      readonly source: "exact";
      readonly activeStrategy: QueryStrategy;
      readonly prior: null;
    }
  | {
      readonly source: "prior";
      readonly activeStrategy: null;
      readonly prior: RecipePrior;
    }
  | {
      readonly source: "none";
      readonly activeStrategy: null;
      readonly prior: null;
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

async function recordRecipeLookup(
  sql: Sql,
  event: {
    readonly executionSignature: string;
    readonly semanticFamilyHash: string | null;
    readonly outcome: "exact_hit" | "exact_miss" | "prior_available";
    readonly strategy: QueryStrategy | null;
    readonly priorEvidenceCount: number;
  },
): Promise<void> {
  try {
    await sql`
      INSERT INTO query_recipe_lookup_events
        (execution_signature, semantic_family_hash, outcome, strategy,
         prior_evidence_count)
      VALUES
        (${event.executionSignature}, ${event.semanticFamilyHash},
         ${event.outcome}, ${event.strategy}, ${event.priorEvidenceCount})
    `;
  } catch {
    return;
  }
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

    const strategy = parsed.data[0]?.strategy ?? null;

    void recordRecipeLookup(sql, {
      executionSignature: signature,
      semanticFamilyHash: null,
      outcome: strategy === null ? "exact_miss" : "exact_hit",
      strategy,
      priorEvidenceCount: 0,
    });

    return okAsync(strategy);
  });
}

async function resolveRecipeGuidance(
  sql: Sql,
  identity: RecipeIdentity,
  recordLookup: boolean,
): Promise<RecipeGuidance> {
  const activeRows = await sql`
    SELECT versions.strategy
    FROM active_query_recipes AS active
    INNER JOIN query_recipe_versions AS versions
      ON versions.analysis_signature = active.analysis_signature
     AND versions.version = active.version
    WHERE active.analysis_signature = ${identity.executionSignature}
    LIMIT 1
  `;
  const active = activeRecipeRowsSchema.parse(activeRows)[0]?.strategy ?? null;

  if (active !== null) {
    if (recordLookup) {
      await recordRecipeLookup(sql, {
        executionSignature: identity.executionSignature,
        semanticFamilyHash: identity.semanticFamilyHash,
        outcome: "exact_hit",
        strategy: active,
        priorEvidenceCount: 0,
      });
    }

    return {
      source: "exact",
      activeStrategy: active,
      prior: null,
    };
  }

  const priorRows = await sql`
    SELECT
      versions.strategy,
      COUNT(*) AS evidence_count,
      percentile_cont(0.5) WITHIN GROUP (
        ORDER BY versions.server_elapsed_ms
      ) AS median_server_elapsed_ms
    FROM active_query_recipes AS active
    INNER JOIN query_recipe_versions AS versions
      ON versions.analysis_signature = active.analysis_signature
     AND versions.version = active.version
    WHERE versions.semantic_family_hash = ${identity.semanticFamilyHash}
      AND active.analysis_signature <> ${identity.executionSignature}
    GROUP BY versions.strategy
    ORDER BY
      evidence_count DESC,
      median_server_elapsed_ms ASC,
      versions.strategy ASC
    LIMIT 1
  `;
  const parsedPriors = priorRecipeRowsSchema.parse(priorRows);
  const row = parsedPriors[0];

  if (row === undefined) {
    if (recordLookup) {
      await recordRecipeLookup(sql, {
        executionSignature: identity.executionSignature,
        semanticFamilyHash: identity.semanticFamilyHash,
        outcome: "exact_miss",
        strategy: null,
        priorEvidenceCount: 0,
      });
    }

    return {
      source: "none",
      activeStrategy: null,
      prior: null,
    };
  }

  if (recordLookup) {
    await recordRecipeLookup(sql, {
      executionSignature: identity.executionSignature,
      semanticFamilyHash: identity.semanticFamilyHash,
      outcome: "prior_available",
      strategy: row.strategy,
      priorEvidenceCount: row.evidence_count,
    });
  }

  return {
    source: "prior",
    activeStrategy: null,
    prior: {
      strategy: row.strategy,
      evidenceCount: row.evidence_count,
      medianServerElapsedMs: row.median_server_elapsed_ms,
    },
  };
}

export function getRecipeGuidance(
  identity: RecipeIdentity,
  options: {
    readonly recordLookup?: boolean;
  } = {},
): ResultAsync<RecipeGuidance, RecipeRegistryError> {
  const sql = getPostgresClient();

  if (sql === null) {
    return okAsync({
      source: "none",
      activeStrategy: null,
      prior: null,
    });
  }

  return ResultAsync.fromPromise(
    resolveRecipeGuidance(sql, identity, options.recordLookup ?? true),
    toRegistryError,
  );
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

      if (promotion.semanticFamilyHash === undefined) {
        await transaction`
          INSERT INTO query_recipe_versions
            (analysis_signature, version, strategy, fingerprint,
             server_elapsed_ms)
          VALUES
            (${promotion.signature}, ${version}, ${promotion.strategy},
             ${promotion.fingerprint}, ${promotion.serverElapsedMs})
        `;
      } else {
        await transaction`
          INSERT INTO query_recipe_versions
            (analysis_signature, semantic_family_hash, version, strategy,
             fingerprint, server_elapsed_ms)
          VALUES
            (${promotion.signature}, ${promotion.semanticFamilyHash}, ${version},
             ${promotion.strategy}, ${promotion.fingerprint},
             ${promotion.serverElapsedMs})
        `;
      }

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
