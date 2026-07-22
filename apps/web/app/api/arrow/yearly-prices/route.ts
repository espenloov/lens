import { Readable } from "node:stream";

import { queryYearlyPricesAsArrow } from "@/lib/clickhouse/arrow-stream";

export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  const result = await queryYearlyPricesAsArrow({
    dateFrom: "2015-01-01",
    dateTo: "2023-12-31",
    town: "Manchester",
  });

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
