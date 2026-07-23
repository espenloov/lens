import type { AnalysisQuerySource } from "@/lib/analysis/query-compiler";

import type { AnalysisDataSource } from "./contracts";

export function toAnalysisQuerySource(
  source: AnalysisDataSource,
): AnalysisQuerySource {
  if (source.mappingSql === null) {
    return {
      fromClause: "pp_complete",
      supportsPrewhere: source.supportsPrewhere,
      manifest: source.manifest,
    };
  }

  return {
    fromClause: `(${source.mappingSql}) AS lens_source`,
    supportsPrewhere: false,
    manifest: source.manifest,
  };
}
