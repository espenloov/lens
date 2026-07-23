import type { Readable } from "node:stream";

import type { ResponseHeaders } from "@clickhouse/client";
import { errAsync, ResultAsync } from "neverthrow";

import { compileSemanticAnalysisQuery } from "@/lib/analysis/query-compiler";
import {
  prepareSemanticAnalysis,
  type SemanticAnalysisRequest,
} from "@/lib/analysis/semantic-plan";
import { getAnalysisDataSource } from "@/lib/data-sources/registry";
import { toAnalysisQuerySource } from "@/lib/data-sources/query-source";
import type { QueryStrategy } from "@/lib/query-arena/contracts";

import { getClickHouseClient } from "./client";

export type SemanticArrowResult = {
  readonly stream: Readable;
  readonly queryId: string;
  readonly responseHeaders: ResponseHeaders;
  readonly shape: SemanticAnalysisRequest["shape"];
  readonly summary:
    | {
        readonly read_rows: string;
        readonly read_bytes: string;
        readonly elapsed_ns: string;
      }
    | undefined;
};

export type SemanticArrowQueryOptions = {
  readonly strategy?: QueryStrategy;
  readonly benchmark?: boolean;
};

export type SemanticArrowQueryError = {
  readonly type: "semantic_arrow_query_error";
  readonly message: string;
  readonly cause: unknown;
};

function queryError(cause: unknown): SemanticArrowQueryError {
  return {
    type: "semantic_arrow_query_error",
    message:
      cause instanceof Error
        ? cause.message
        : "ClickHouse could not produce the semantic Arrow stream",
    cause,
  };
}

export function querySemanticAnalysisAsArrow(
  request: SemanticAnalysisRequest,
  options: SemanticArrowQueryOptions = {},
): ResultAsync<SemanticArrowResult, SemanticArrowQueryError> {
  return getAnalysisDataSource(
    request.plan.dataset,
    request.plan.datasetVersion,
  )
    .mapErr(queryError)
    .andThen((source) => {
      const prepared = prepareSemanticAnalysis(
        request.plan,
        source.manifest,
        {
          dataset: source.slug,
          datasetVersion: source.version,
        },
      );

      if (prepared.isErr()) {
        return errAsync(queryError(new Error(prepared.error.message)));
      }

      if (
        request.shape !== prepared.value.shape ||
        request.transform !== prepared.value.transform ||
        JSON.stringify(request.presentation) !==
          JSON.stringify(prepared.value.presentation)
      ) {
        return errAsync(
          queryError(
            new Error(
              "The semantic request does not match the pinned dataset manifest",
            ),
          ),
        );
      }

      const compiled = compileSemanticAnalysisQuery(
        prepared.value.plan,
        toAnalysisQuerySource(source),
        options.strategy ?? "baseline",
      );

      return ResultAsync.fromPromise(
        getClickHouseClient().exec({
          query: compiled.query,
          query_params: compiled.queryParams,
          clickhouse_settings: {
            max_execution_time: 20,
            max_result_rows: compiled.settings.max_result_rows,
            max_result_bytes: "16777216",
            max_rows_to_group_by: compiled.settings.max_rows_to_group_by,
            max_memory_usage: "536870912",
            group_by_overflow_mode: "throw",
            output_format_arrow_compression_method: "lz4_frame",
            output_format_arrow_string_as_string: 1,
            result_overflow_mode: "throw",
            readonly: "1",
            optimize_move_to_prewhere:
              compiled.settings.optimize_move_to_prewhere,
            ...(options.benchmark ? { use_query_cache: 0 } : {}),
          },
        }),
        queryError,
      ).map((response) => ({
        stream: response.stream,
        queryId: response.query_id,
        responseHeaders: response.response_headers,
        shape: prepared.value.shape,
        summary: response.summary,
      }));
    });
}
