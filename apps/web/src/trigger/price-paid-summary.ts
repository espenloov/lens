import { logger, schemaTask } from "@trigger.dev/sdk/v3";
import { z } from "zod";

import { getPricePaidSummary } from "@/lib/clickhouse/price-paid-summary";

const payloadSchema = z.object({
  source: z.enum(["web", "manual"]),
});

export const pricePaidSummaryTask = schemaTask({
  id: "price-paid-summary",
  schema: payloadSchema,
  maxDuration: 60,

  run: async ({ source }) => {
    const startedAt = performance.now();
    const summary = await getPricePaidSummary();
    const durationMs = Math.round(performance.now() - startedAt);

    if (summary.isErr()) {
      logger.error("Price Paid summary failed", {
        type: summary.error.type,
        message: summary.error.message,
        durationMs,
        source,
      });

      throw new Error(summary.error.message, {
        cause: summary.error.cause,
      });
    }

    logger.info("Price Paid summary completed", {
      transactionCount: summary.value.transactionCount,
      durationMs,
      source,
    });

    return {
      ...summary.value,
      durationMs,
      calculatedAt: new Date().toISOString(),
    };
  },
});
