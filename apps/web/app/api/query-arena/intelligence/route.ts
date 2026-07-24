import { authorizeDataSourceRead } from "../../../../lib/data-sources/access";
import { getSystemIntelligence } from "../../../../lib/query-arena/intelligence";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const access = authorizeDataSourceRead(request);

  if (access.isErr()) {
    return Response.json(access.error, { status: access.error.status });
  }

  return Response.json(await getSystemIntelligence());
}
