import { compileAnalysisQuery } from "../analysis/query-compiler";
import type { QueryStrategy } from "../query-arena/contracts";

import type { TimeSeriesRequest } from "./contracts";

export function compileTimeSeriesQuery(
  request: TimeSeriesRequest,
  strategy: QueryStrategy = "baseline",
) {
  return compileAnalysisQuery(request, strategy);
}
