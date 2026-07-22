import { z } from "zod";

import { analysisPlanSchema } from "./contracts";
import { executableAnalysisRequestSchema } from "./execution";

const unsupportedAnalysisErrorSchema = z.object({
  type: z.literal("unsupported_analysis_plan"),
  message: z.string().trim().min(1),
});

export const analysisToolOutputSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("ready"),
    plan: analysisPlanSchema,
    request: executableAnalysisRequestSchema,
  }),
  z.object({
    status: z.literal("unsupported"),
    plan: analysisPlanSchema,
    error: unsupportedAnalysisErrorSchema,
  }),
]);

export type AnalysisToolOutput = z.infer<typeof analysisToolOutputSchema>;

export function parseAnalysisToolOutput(value: unknown) {
  return analysisToolOutputSchema.safeParse(value);
}
