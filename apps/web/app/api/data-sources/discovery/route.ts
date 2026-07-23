import { authorizeDataSourceRead } from "../../../../lib/data-sources/access";
import { discoverDataSourcesSchema } from "../../../../lib/data-sources/contracts";
import { listDataSources } from "../../../../lib/data-sources/registry";
import {
  attachRegisteredDiscoverySources,
  discoverClickHouseTables,
} from "../../../../lib/clickhouse/table-discovery";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const access = authorizeDataSourceRead(request);

  if (access.isErr()) {
    return Response.json(access.error, { status: access.error.status });
  }

  const input = discoverDataSourcesSchema.safeParse({
    database: new URL(request.url).searchParams.get("database") ?? undefined,
  });

  if (!input.success) {
    return Response.json(
      { message: "The ClickHouse discovery database is invalid" },
      { status: 400 },
    );
  }

  const discovery = await discoverClickHouseTables(input.data.database);

  if (discovery.isErr()) {
    return Response.json(
      {
        type: discovery.error.type,
        message: discovery.error.message,
      },
      { status: discovery.error.status },
    );
  }

  const registry = await listDataSources();
  const sources = registry.isOk() ? registry.value.sources : [];

  return Response.json(
    attachRegisteredDiscoverySources(discovery.value, sources),
  );
}
