export {
  timeSeriesRequestSchema,
  type GrammarTimeSeriesRequest as TimeSeriesRequest,
} from "../analysis/execution";

import { timeSeriesRequestSchema } from "../analysis/execution";

export const queryArenaTimeSeriesRequestSchema = timeSeriesRequestSchema.refine(
  (request) =>
    request.metric !== "median_price" &&
    request.transform === "value" &&
    (request.operation === "trend" || request.operation === "comparison"),
  {
    message:
      "Query Arena supports exact base trends and comparisons only",
  },
);
