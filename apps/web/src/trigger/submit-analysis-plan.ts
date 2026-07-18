import { schemaTask } from "@trigger.dev/sdk";

import { analysisPlanSchema } from "@/lib/analysis/contracts";

export const submitAnalysisPlanTask = schemaTask({
  id: "submit-analysis-plan",

  description:
    "Submit a structured property-market analysis plan when the user's question contains enough information to run an analysis.",

  schema: analysisPlanSchema,
  maxDuration: 30,

  run: async (plan) => {
    return {
      accepted: true,
      plan,
    };
  },
});
