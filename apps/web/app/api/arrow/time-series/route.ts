import { Readable } from "node:stream";

import { errAsync, okAsync, ResultAsync } from "neverthrow";

import { queryTimeSeriesAsArrow } from "@/lib/clickhouse/arrow-stream";
import {
  timeSeriesRequestSchema,
  type TimeSeriesRequest,
} from "@/lib/time-series/contracts";

export const runtime = "nodejs";

type RequestError = {
  readonly type: "invalid_time_series_request";
  readonly message: string;
};

function parseRequest(
  request: Request,
): ResultAsync<TimeSeriesRequest, RequestError> {
  return ResultAsync.fromPromise(request.json(), () => ({
    type: "invalid_time_series_request" as const,
    message: "The request body must contain valid JSON",
  })).andThen((body) => {
    const parsed = timeSeriesRequestSchema.safeParse(body);

    if (!parsed.success) {
      return errAsync({
        type: "invalid_time_series_request" as const,
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

  const result = await queryTimeSeriesAsArrow(input.value);

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
      "X-Content-Type-Options": "nosniff",
    },
  });
}
