import { Readable } from "node:stream";

import { errAsync, okAsync, ResultAsync } from "neverthrow";

import {
  explorationRequestSchema,
  type ExplorationRequest,
} from "@/lib/analysis/execution";
import { queryExplorationAsArrow } from "@/lib/clickhouse/exploration-arrow";
import { authorizeDataSourceRead } from "@/lib/data-sources/access";

export const runtime = "nodejs";

type RequestError = {
  readonly type: "invalid_exploration_request";
  readonly message: string;
};

function parseRequest(
  request: Request,
): ResultAsync<ExplorationRequest, RequestError> {
  return ResultAsync.fromPromise(request.json(), () => ({
    type: "invalid_exploration_request" as const,
    message: "The request body must contain valid JSON",
  })).andThen((body) => {
    const parsed = explorationRequestSchema.safeParse(body);

    if (!parsed.success) {
      return errAsync({
        type: "invalid_exploration_request" as const,
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

  if (input.value.dataset !== "uk_price_paid") {
    const access = authorizeDataSourceRead(request);

    if (access.isErr()) {
      return Response.json(access.error, { status: access.error.status });
    }
  }

  const result = await queryExplorationAsArrow(input.value, request.signal);

  if (result.isErr()) {
    if (result.error.type === "exploration_too_large") {
      return Response.json(result.error, { status: 413 });
    }

    return Response.json(
      { type: result.error.type, message: result.error.message },
      { status: result.error.type === "exploration_busy" ? 429 : 502 },
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
      "X-Lens-Arrow-Contract": "exploration/v1",
      "X-Lens-Source-Rows": String(result.value.sourceRows),
      "X-Content-Type-Options": "nosniff",
    },
  });
}
