export {
  timeSeriesRequestSchema,
  type GrammarTimeSeriesRequest as TimeSeriesRequest,
} from "../analysis/execution";

import { timeSeriesRequestSchema } from "../analysis/execution";

export const queryArenaTimeSeriesRequestSchema = timeSeriesRequestSchema.refine(
  (request) =>
    request.dataset === "uk_price_paid" &&
    (request.datasetVersion === undefined || request.datasetVersion === 1) &&
    request.metric !== "median_price" &&
    request.transform === "value" &&
    (request.operation === "trend" || request.operation === "comparison"),
  {
    message:
      "Query Arena supports exact built-in trends and comparisons only",
  },
);
