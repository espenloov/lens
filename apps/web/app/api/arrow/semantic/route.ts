import { Readable } from "node:stream";

import { errAsync, okAsync, ResultAsync } from "neverthrow";

import {
  semanticAnalysisRequestSchema,
  type SemanticAnalysisRequest,
} from "@/lib/analysis/semantic-plan";
import { querySemanticAnalysisAsArrow } from "@/lib/clickhouse/semantic-arrow";
import { authorizeDataSourceRead } from "@/lib/data-sources/access";
import { getActiveRecipe } from "@/lib/query-arena/recipe-registry";
import { queryArenaSemanticRequestSchema } from "@/lib/query-arena/contracts";
import {
  createQueryArenaSignature,
} from "@/lib/query-arena/signature";

export const runtime = "nodejs";

type RequestError = {
  readonly type: "invalid_semantic_analysis_request";
  readonly message: string;
};

function parseRequest(
  request: Request,
): ResultAsync<SemanticAnalysisRequest, RequestError> {
  return ResultAsync.fromPromise(request.json(), () => ({
    type: "invalid_semantic_analysis_request" as const,
    message: "The request body must contain valid JSON",
  })).andThen((body) => {
    const parsed = semanticAnalysisRequestSchema.safeParse(body);

    return parsed.success
      ? okAsync(parsed.data)
      : errAsync({
          type: "invalid_semantic_analysis_request" as const,
          message:
            parsed.error.issues[0]?.message ??
            "The semantic analysis request is invalid",
        });
  });
}

export async function POST(request: Request): Promise<Response> {
  const access = authorizeDataSourceRead(request);

  if (access.isErr()) {
    return Response.json(access.error, { status: access.error.status });
  }

  const input = await parseRequest(request);

  if (input.isErr()) {
    return Response.json(input.error, { status: 400 });
  }

  const arenaRequest = queryArenaSemanticRequestSchema.safeParse(input.value);
  const signature = arenaRequest.success
    ? createQueryArenaSignature({
        kind: "semantic",
        request: arenaRequest.data,
      })
    : null;
  const preferredStrategy =
    signature === null ? null : await getActiveRecipe(signature);
  const strategy =
    preferredStrategy?.isOk() === true
      ? (preferredStrategy.value ?? "baseline")
      : "baseline";
  const result = await querySemanticAnalysisAsArrow(input.value, { strategy });

  if (result.isErr()) {
    return Response.json(
      {
        error: result.error.type,
        message: result.error.message,
      },
      { status: 502 },
    );
  }

  const webStream = Readable.toWeb(
    result.value.stream,
  ) as ReadableStream<Uint8Array>;

  return new Response(webStream, {
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/vnd.apache.arrow.stream",
      "X-ClickHouse-Query-Id": result.value.queryId,
      "X-Lens-Arrow-Contract": `${result.value.shape}/v1`,
      "X-Lens-Query-Strategy": strategy,
      "X-Content-Type-Options": "nosniff",
      ...(signature === null
        ? {}
        : { "X-Lens-Analysis-Signature": signature }),
    },
  });
}
