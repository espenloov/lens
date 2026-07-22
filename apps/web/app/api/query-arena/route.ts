import type { queryArenaTask } from "@/src/trigger/query-arena";
import { tasks } from "@trigger.dev/sdk";
import { ResultAsync } from "neverthrow";

import {
  queryArenaStartResponseSchema,
  queryArenaStartSchema,
} from "@/lib/query-arena/contracts";
import {
  createAnalysisSignature,
  createArenaId,
} from "@/lib/query-arena/signature";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
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

  const signature = createAnalysisSignature(input.data.request);
  const arenaId = createArenaId(signature);
  const triggered = await ResultAsync.fromPromise(
    tasks.trigger<typeof queryArenaTask>(
      "query-arena",
      {
        arenaId,
        signature,
        request: input.data.request,
      },
      {
        idempotencyKey: arenaId,
        idempotencyKeyTTL: "1h",
        tags: [`arena:${arenaId}`, `analysis:${signature.slice(0, 24)}`],
        metadata: {
          phase: "queued",
          progress: 0,
          strategies: ["baseline", "prewhere"],
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
