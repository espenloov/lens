import {
  BUILTIN_QUERY_SOURCE,
  compileAnalysisQuery,
  type AnalysisQuerySource,
} from "../analysis/query-compiler";
import type { QueryStrategy } from "../query-arena/contracts";

import type { TimeSeriesRequest } from "./contracts";

export function compileTimeSeriesQuery(
  request: TimeSeriesRequest,
  strategy: QueryStrategy = "baseline",
  source: AnalysisQuerySource = BUILTIN_QUERY_SOURCE,
) {
  return compileAnalysisQuery(request, strategy, source);
}
