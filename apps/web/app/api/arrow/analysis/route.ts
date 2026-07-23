import { Readable } from "node:stream";

import { errAsync, okAsync, ResultAsync } from "neverthrow";

import {
  executableAnalysisRequestSchema,
  type ExecutableAnalysisRequest,
} from "@/lib/analysis/execution";
import { queryAnalysisAsArrow } from "@/lib/clickhouse/analysis-arrow";
import { authorizeDataSourceRead } from "@/lib/data-sources/access";

export const runtime = "nodejs";

type RequestError = {
  readonly type: "invalid_analysis_request";
  readonly message: string;
};

function parseRequest(
  request: Request,
): ResultAsync<ExecutableAnalysisRequest, RequestError> {
  return ResultAsync.fromPromise(request.json(), () => ({
    type: "invalid_analysis_request" as const,
    message: "The request body must contain valid JSON",
  })).andThen((body) => {
    const parsed = executableAnalysisRequestSchema.safeParse(body);

    if (!parsed.success) {
      return errAsync({
        type: "invalid_analysis_request" as const,
        message: parsed.error.issues[0]?.message ?? "The request is invalid",
      });
    }

    return okAsync(parsed.data);
  });
}

export async function POST(request: Request): Promise<Response> {
  const input = await parseRequest(request);

  if (input.isErr()) {
    return Response.json(input.error, { status: 400 });
  }

  if (
    input.value.shape === "time_series" ||
    input.value.shape === "exploration"
  ) {
    return Response.json(
      {
        type: "invalid_analysis_request",
        message: "This analysis shape uses a dedicated optimized endpoint",
      },
      { status: 400 },
    );
  }

  if (input.value.dataset !== "uk_price_paid") {
    const access = authorizeDataSourceRead(request);

    if (access.isErr()) {
      return Response.json(access.error, { status: access.error.status });
    }
  }

  const result = await queryAnalysisAsArrow(input.value);

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
      "X-Lens-Arrow-Contract": `${input.value.shape}/v1`,
      "X-Content-Type-Options": "nosniff",
    },
  });
}
