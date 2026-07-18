import { z } from "zod";

export const analysisQuestionSchema = z.object({
  question: z.string().trim().min(3).max(1_000),
});

const propertyTypeSchema = z.enum([
  "terraced",
  "semi-detached",
  "detached",
  "flat",
  "other",
]);

const dimensionSchema = z.enum([
  "year",
  "month",
  "town",
  "district",
  "county",
  "property_type",
]);

const locationFilterSchema = z.object({
  level: z.enum(["town", "district", "county"]),
  values: z.array(z.string().trim().min(1)).max(10),
});

export const analysisPlanSchema = z.object({
  title: z.string().trim().min(1).max(80),

  analysisType: z.enum([
    "summary",
    "trend",
    "comparison",
    "geography",
    "distribution",
    "ranking",
    "similarity",
  ]),

  metric: z.enum([
    "average_price",
    "median_price",
    "transaction_count",
    "price_change_percentage",
    "affordability_share",
  ]),

  groupBy: z.array(dimensionSchema).max(2),

  filters: z.object({
    dateFrom: z.iso.date().nullable(),
    dateTo: z.iso.date().nullable(),
    propertyTypes: z.array(propertyTypeSchema).max(5),
    newBuild: z.boolean().nullable(),
    tenure: z.array(z.enum(["freehold", "leasehold", "unknown"])).max(3),
    location: locationFilterSchema.nullable(),
    maximumPrice: z.number().int().positive().nullable(),
  }),

  order: z.enum(["ascending", "descending"]).nullable(),
  limit: z.number().int().min(1).max(50).nullable(),

  visualization: z.enum([
    "metric",
    "time_series",
    "comparison",
    "map",
    "distribution",
    "answer_space",
  ]),

  explanation: z.string().trim().min(1).max(240),
});

export const analysisDecisionSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("analysis"),
    plan: analysisPlanSchema,
  }),
  z.object({
    kind: z.literal("clarification"),
    question: z.string().trim().min(1).max(240),
    suggestions: z.array(z.string().trim().min(1).max(80)).max(3),
  }),
]);

export type AnalysisQuestion = z.infer<typeof analysisQuestionSchema>;

export type AnalysisPlan = z.infer<typeof analysisPlanSchema>;

export type AnalysisDecision = z.infer<typeof analysisDecisionSchema>;
