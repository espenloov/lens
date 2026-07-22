import { logger, schemaTask } from "@trigger.dev/sdk";

import { analysisPlanSchema } from "@/lib/analysis/contracts";
import { toTimeSeriesRequest } from "@/lib/analysis/time-series-adapter";

export const submitAnalysisPlanTask = schemaTask({
  id: "submit-analysis-plan",

  description:
    "Execute a structured UK property-market analysis plan using ClickHouse.",

  schema: analysisPlanSchema,
  maxDuration: 30,

  run: async (plan) => {
    const request = toTimeSeriesRequest(plan);

    if (request.isOk()) {
      logger.info("Time-series analysis prepared", {
        metric: request.value.metric,
        interval: request.value.interval,
        locationCount: request.value.location.values.length,
      });

      return {
        status: "ready" as const,
        plan,
        request: request.value,
      };
    }

    logger.warn("Property analysis is not supported yet", {
      message: request.error.message,
    });

    return {
      status: "unsupported" as const,
      plan,
      error: request.error,
    };
  },
});
