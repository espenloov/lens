import { z } from "zod";

export const yearlyAveragePricePointSchema = z.object({
  year: z.coerce.number().int().min(1995).max(2024),
  averagePrice: z.coerce.number().int().nonnegative(),
  transactionCount: z.coerce.number().int().positive(),
});

export const yearlyAveragePriceResultSchema = z.object({
  kind: z.literal("yearly_average_price"),
  points: z.array(yearlyAveragePricePointSchema).max(30),
  queryId: z.string().trim().min(1),
  performance: z.object({
    roundTripMs: z.number().int().nonnegative(),
    serverElapsedMs: z.number().nonnegative().nullable(),
    rowsRead: z.number().int().nonnegative().nullable(),
    bytesRead: z.number().int().nonnegative().nullable(),
  }),
  calculatedAt: z.iso.datetime(),
});

export type YearlyAveragePricePoint = z.infer<
  typeof yearlyAveragePricePointSchema
>;

export type YearlyAveragePriceResult = z.infer<
  typeof yearlyAveragePriceResultSchema
>;
