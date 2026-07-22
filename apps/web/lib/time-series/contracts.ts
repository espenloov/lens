import { z } from "zod";

export const timeSeriesMetricSchema = z.enum([
  "average_price",
  "transaction_count",
]);

export const timeSeriesIntervalSchema = z.enum(["year", "month"]);

export const timeSeriesLocationLevelSchema = z.enum(["town", "county"]);

export const timeSeriesPropertyTypeSchema = z.enum([
  "terraced",
  "semi-detached",
  "detached",
  "flat",
  "other",
]);

export const timeSeriesRequestSchema = z
  .object({
    metric: timeSeriesMetricSchema,
    interval: timeSeriesIntervalSchema,
    dateFrom: z.iso.date(),
    dateTo: z.iso.date(),
    location: z.object({
      level: timeSeriesLocationLevelSchema,
      values: z.array(z.string().trim().min(1).max(80)).min(1).max(5),
    }),
    propertyTypes: z.array(timeSeriesPropertyTypeSchema).max(5).default([]),
  })
  .superRefine((request, context) => {
    if (request.dateFrom > request.dateTo) {
      context.addIssue({
        code: "custom",
        message: "The start date must be before the end date",
        path: ["dateTo"],
      });
    }
  });

export type TimeSeriesMetric = z.infer<typeof timeSeriesMetricSchema>;

export type TimeSeriesInterval = z.infer<typeof timeSeriesIntervalSchema>;

export type TimeSeriesLocationLevel = z.infer<
  typeof timeSeriesLocationLevelSchema
>;

export type TimeSeriesPropertyType = z.infer<
  typeof timeSeriesPropertyTypeSchema
>;

export type TimeSeriesRequest = z.infer<typeof timeSeriesRequestSchema>;
