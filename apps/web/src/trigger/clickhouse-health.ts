import { logger, schemaTask } from "@trigger.dev/sdk/v3";
import { z } from "zod";

import { checkClickHouseConnection } from "@/lib/clickhouse/health";

const payloadSchema = z.object({
  source: z.enum(["web", "manual"]),
});

export const clickHouseHealthTask = schemaTask({
  id: "clickhouse-health",
  schema: payloadSchema,
  maxDuration: 30,

  run: async ({ source }) => {
    const health = await checkClickHouseConnection();

    if (health.isErr()) {
      logger.error("ClickHouse health check failed", {
        type: health.error.type,
        message: health.error.message,
        source,
      });

      throw new Error(health.error.message, {
        cause: health.error.cause,
      });
    }

    logger.info("ClickHouse connection is healthy", {
      source,
    });

    return {
      healthy: true,
      checkedAt: new Date().toISOString(),
    };
  },
});
