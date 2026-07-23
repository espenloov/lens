import { z } from "zod";

import {
  semanticAnalysisPlanSchema,
  semanticAnalysisRequestSchema,
} from "./semantic-plan";

const semanticPlanErrorSchema = z.object({
  type: z.literal("semantic_plan_error"),
  message: z.string().trim().min(1),
});

export const semanticAnalysisToolOutputSchema = z.discriminatedUnion(
  "status",
  [
    z.object({
      status: z.literal("ready"),
      plan: semanticAnalysisPlanSchema,
      request: semanticAnalysisRequestSchema,
    }),
    z.object({
      status: z.literal("unsupported"),
      plan: semanticAnalysisPlanSchema,
      error: semanticPlanErrorSchema,
    }),
  ],
);

export type SemanticAnalysisToolOutput = z.infer<
  typeof semanticAnalysisToolOutputSchema
>;

export function parseSemanticAnalysisToolOutput(value: unknown) {
  return semanticAnalysisToolOutputSchema.safeParse(value);
}
