import { z } from "zod";

export const analysisConversationResponseSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("clarification"),
    message: z.string().trim().min(1).max(240),
  }),
  z.object({
    kind: z.literal("out_of_scope"),
    message: z.string().trim().min(1).max(240),
  }),
]);

export type AnalysisConversationResponse = z.infer<
  typeof analysisConversationResponseSchema
>;

export function parseAnalysisConversationResponse(value: unknown) {
  return analysisConversationResponseSchema.safeParse(value);
}
