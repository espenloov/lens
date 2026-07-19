import { logger, schemaTask } from "@trigger.dev/sdk";

import { analysisPlanSchema } from "@/lib/analysis/contracts";
import { executeAnalysisPlan } from "@/lib/analysis/executor";

export const submitAnalysisPlanTask = schemaTask({
  id: "submit-analysis-plan",

  description:
    "Execute a structured UK property-market analysis plan using ClickHouse.",

  schema: analysisPlanSchema,
  maxDuration: 30,

  run: async (plan) => {
    const execution = await executeAnalysisPlan(plan);

    if (execution.isOk()) {
      logger.info("Property analysis completed", {
        pointCount: execution.value.points.length,
        queryId: execution.value.queryId,
        ...execution.value.performance,
      });

      return {
        status: "completed" as const,
        plan,
        result: execution.value,
      };
    }

    if (execution.error.type === "unsupported_analysis_plan") {
      logger.warn("Property analysis is not supported yet", {
        message: execution.error.message,
      });

      return {
        status: "unsupported" as const,
        plan,
        error: {
          type: execution.error.type,
          message: execution.error.message,
        },
      };
    }

    logger.error("Property analysis failed", {
      type: execution.error.type,
      message: execution.error.message,
    });

    throw new Error(execution.error.message);
  },
});
