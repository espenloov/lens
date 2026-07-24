import { Readable } from "node:stream";

import { errAsync, okAsync, ResultAsync } from "neverthrow";

import { queryTimeSeriesAsArrow } from "@/lib/clickhouse/arrow-stream";
import { getRecipeGuidance } from "@/lib/query-arena/recipe-registry";
import {
  createAnalysisSignature,
  createQueryArenaIdentity,
} from "@/lib/query-arena/signature";
import {
  queryArenaTimeSeriesRequestSchema,
  timeSeriesRequestSchema,
  type TimeSeriesRequest,
} from "@/lib/time-series/contracts";
import { authorizeDataSourceRead } from "@/lib/data-sources/access";

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

  if (input.value.dataset !== "uk_price_paid") {
    const access = authorizeDataSourceRead(request);

    if (access.isErr()) {
      return Response.json(access.error, { status: access.error.status });
    }
  }

  const signature = createAnalysisSignature(input.value);
  const arenaRequest = queryArenaTimeSeriesRequestSchema.safeParse(
    input.value,
  );
  const identity = arenaRequest.success
    ? createQueryArenaIdentity({
        kind: "time_series",
        request: arenaRequest.data,
      })
    : null;
  const guidance =
    identity === null ? null : await getRecipeGuidance(identity);
  const strategy =
    guidance?.isOk() === true && guidance.value.source === "exact"
      ? guidance.value.activeStrategy
      : "baseline";
  const result = await queryTimeSeriesAsArrow(input.value, { strategy });

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
      "X-Lens-Analysis-Signature":
        identity?.executionSignature ?? signature,
      ...(identity === null
        ? {}
        : {
            "X-Lens-Semantic-Family": identity.semanticFamilyHash,
            "X-Lens-Learning-Source":
              guidance?.isOk() === true ? guidance.value.source : "none",
          }),
      "X-Lens-Arrow-Contract": "time_series/v1",
      "X-Lens-Query-Strategy": strategy,
      "X-Content-Type-Options": "nosniff",
    },
  });
}
