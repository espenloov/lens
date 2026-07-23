import { errAsync, okAsync, ResultAsync } from "neverthrow";

import { inspectDataSourceSchema } from "@/lib/data-sources/contracts";
import { authorizeDataSourceMutation } from "@/lib/data-sources/access";
import { inspectClickHouseRelation } from "@/lib/clickhouse/schema-inspection";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  const access = authorizeDataSourceMutation(request);

  if (access.isErr()) {
    return Response.json(access.error, { status: access.error.status });
  }

  const input = await ResultAsync.fromPromise(request.json(), () => null).andThen(
    (body) => {
      const parsed = inspectDataSourceSchema.safeParse(body);
      return parsed.success ? okAsync(parsed.data) : errAsync(parsed.error);
    },
  );

  if (input.isErr()) {
    return Response.json({ message: "The ClickHouse relation is invalid" }, { status: 400 });
  }

  const inspection = await inspectClickHouseRelation(
    input.value.database,
    input.value.table,
  );

  return inspection.isOk()
    ? Response.json(inspection.value)
    : Response.json(
        { type: inspection.error.type, message: inspection.error.message },
        { status: 404 },
      );
}
