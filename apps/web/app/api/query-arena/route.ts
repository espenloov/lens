import type { queryArenaTask } from "@/src/trigger/query-arena";
import { tasks } from "@trigger.dev/sdk";
import { ResultAsync } from "neverthrow";

import {
  queryArenaStartResponseSchema,
  queryArenaStartSchema,
} from "@/lib/query-arena/contracts";
import { authorizeDataSourceRead } from "@/lib/data-sources/access";
import {
  createQueryArenaSignature,
  createArenaId,
} from "@/lib/query-arena/signature";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  const access = authorizeDataSourceRead(request);

  if (access.isErr()) {
    return Response.json(access.error, { status: access.error.status });
  }

  const body = await ResultAsync.fromPromise(request.json(), () => null);

  if (body.isErr()) {
    return Response.json({ message: "The request must be valid JSON" }, { status: 400 });
  }

  const input = queryArenaStartSchema.safeParse(body.value);

  if (!input.success) {
    return Response.json(
      { message: input.error.issues[0]?.message ?? "The request is invalid" },
      { status: 400 },
    );
  }

  const signature = createQueryArenaSignature(input.data.analysis);
  const arenaId = createArenaId(signature);
  const triggered = await ResultAsync.fromPromise(
    tasks.trigger<typeof queryArenaTask>(
      "query-arena",
      {
        analysis: input.data.analysis,
        arenaId,
        signature,
      },
      {
        idempotencyKey: arenaId,
        idempotencyKeyTTL: "1h",
        tags: [`arena:${arenaId}`, `analysis:${signature.slice(0, 24)}`],
        metadata: {
          phase: "queued",
          progress: 0,
          strategies: ["baseline", "prewhere"],
          dataset:
            input.data.analysis.kind === "semantic"
              ? input.data.analysis.request.plan.dataset
              : input.data.analysis.request.dataset,
          completedCandidates: 0,
          candidateEvents: [],
        },
      },
    ),
    (cause) => cause,
  );

  if (triggered.isErr()) {
    return Response.json(
      { message: "The Query Arena could not be started" },
      { status: 503 },
    );
  }

  return Response.json(
    queryArenaStartResponseSchema.parse({
      runId: triggered.value.id,
      arenaId,
      signature,
    }),
    { status: 202 },
  );
}
