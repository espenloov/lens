import type { AnalysisPlan } from "./contracts";
import { toTimeSeriesRequest } from "./time-series-adapter";
import type { AnalysisToolOutput } from "./tool-output";

export function prepareAnalysis(plan: AnalysisPlan): AnalysisToolOutput {
  const request = toTimeSeriesRequest(plan);

  if (request.isOk()) {
    return {
      status: "ready",
      plan,
      request: request.value,
    };
  }

  return {
    status: "unsupported",
    plan,
    error: request.error,
  };
}
