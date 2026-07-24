"use client";

import axios from "axios";
import { ResultAsync } from "neverthrow";
import { z } from "zod";

export const systemIntelligenceSchema = z.object({
  available: z.boolean(),
  clickHouseAvailable: z.boolean(),
  registryAvailable: z.boolean(),
  verifiedRaces: z.number().int().nonnegative(),
  recipeActivations: z.number().int().nonnegative(),
  semanticFamilies: z.number().int().nonnegative(),
  exactHits: z.number().int().nonnegative(),
  priorSuggestions: z.number().int().nonnegative(),
  exactHitRate: z.number().min(0).max(1).nullable(),
  baselineP50Ms: z.number().nonnegative().nullable(),
  baselineP95Ms: z.number().nonnegative().nullable(),
  winnerP50Ms: z.number().nonnegative().nullable(),
  winnerP95Ms: z.number().nonnegative().nullable(),
  accumulatedServerMsSaved: z.number().nonnegative(),
});

export type SystemIntelligenceSnapshot = z.infer<
  typeof systemIntelligenceSchema
>;

export type SystemIntelligenceClientError = {
  readonly type: "system_intelligence_client_error";
  readonly message: string;
  readonly cause: unknown;
};

function clientError(cause: unknown): SystemIntelligenceClientError {
  return {
    type: "system_intelligence_client_error",
    message: "System intelligence is temporarily unavailable",
    cause,
  };
}

export function loadSystemIntelligence() {
  return ResultAsync.fromPromise(
    axios.get<unknown>("/api/query-arena/intelligence"),
    clientError,
  ).andThen((response) =>
    ResultAsync.fromPromise(
      systemIntelligenceSchema.parseAsync(response.data),
      clientError,
    ),
  );
}
