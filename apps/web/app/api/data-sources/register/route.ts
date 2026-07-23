import { createHash } from "node:crypto";

import type { registerDataSourceTask } from "@/src/trigger/register-data-source";
import { tasks } from "@trigger.dev/sdk";
import { ResultAsync } from "neverthrow";

import {
  registerDataSourceSchema,
  registrationStartResponseSchema,
} from "@/lib/data-sources/contracts";
import { authorizeDataSourceMutation } from "@/lib/data-sources/access";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  const access = authorizeDataSourceMutation(request);

  if (access.isErr()) {
    return Response.json(access.error, { status: access.error.status });
  }

  const body = await ResultAsync.fromPromise(request.json(), () => null);

  if (body.isErr()) {
    return Response.json({ message: "The request must be valid JSON" }, { status: 400 });
  }

  const input = registerDataSourceSchema.safeParse(body.value);

  if (!input.success) {
    return Response.json(
      { message: input.error.issues[0]?.message ?? "The data source is invalid" },
      { status: 400 },
    );
  }

  const digest = createHash("sha256")
    .update(
      `${input.data.slug}\n${input.data.database}.${input.data.table}\n${input.data.mappingSql}\n${input.data.manifest === undefined ? "agent-generated" : JSON.stringify(input.data.manifest)}`,
    )
    .digest("hex");
  const triggered = await ResultAsync.fromPromise(
    tasks.trigger<typeof registerDataSourceTask>(
      "register-data-source",
      input.data,
      {
        tags: [`dataset:${input.data.slug}`, `mapping:${digest.slice(0, 20)}`],
        metadata: {
          phase: "queued",
          progress: 0,
        },
      },
    ),
    (cause) => cause,
  );

  if (triggered.isErr()) {
    return Response.json(
      { message: "The dataset validation could not be started" },
      { status: 503 },
    );
  }

  return Response.json(
    registrationStartResponseSchema.parse({ runId: triggered.value.id }),
    { status: 202 },
  );
}
