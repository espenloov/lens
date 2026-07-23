import { errAsync, okAsync, ResultAsync } from "neverthrow";
import { z } from "zod";

import { datasetSlugSchema } from "@/lib/data-sources/contracts";
import {
  authorizeDataSourceMutation,
  authorizeDataSourceRead,
} from "@/lib/data-sources/access";
import {
  listDataSources,
  selectDataSource,
} from "@/lib/data-sources/registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const selectionSchema = z.object({
  slug: datasetSlugSchema,
});

export async function GET(request: Request): Promise<Response> {
  const access = authorizeDataSourceRead(request);

  if (access.isErr()) {
    return Response.json(access.error, { status: access.error.status });
  }

  const sources = await listDataSources();

  return sources.isOk()
    ? Response.json(sources.value)
    : Response.json(
        { type: sources.error.type, message: sources.error.message },
        { status: 503 },
      );
}

export async function PATCH(request: Request): Promise<Response> {
  const access = authorizeDataSourceMutation(request);

  if (access.isErr()) {
    return Response.json(access.error, { status: access.error.status });
  }

  const input = await ResultAsync.fromPromise(request.json(), () => null).andThen(
    (body) => {
      const parsed = selectionSchema.safeParse(body);
      return parsed.success ? okAsync(parsed.data) : errAsync(parsed.error);
    },
  );

  if (input.isErr()) {
    return Response.json({ message: "The dataset selection is invalid" }, { status: 400 });
  }

  const selected = await selectDataSource(input.value.slug);

  return selected.isOk()
    ? Response.json(selected.value)
    : Response.json(
        { type: selected.error.type, message: selected.error.message },
        { status: 503 },
      );
}
