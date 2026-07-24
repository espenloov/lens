import type { queryArenaTask } from "@/src/trigger/query-arena";
import { tasks } from "@trigger.dev/sdk";
import { ResultAsync } from "neverthrow";

import {
  queryArenaStartResponseSchema,
  queryArenaStartSchema,
} from "@/lib/query-arena/contracts";
import { authorizeDataSourceRead } from "@/lib/data-sources/access";
import {
  createQueryArenaIdentity,
  createArenaId,
} from "@/lib/query-arena/signature";
import { getRecipeGuidance } from "@/lib/query-arena/recipe-registry";

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

  const identity = createQueryArenaIdentity(input.data.analysis);
  const signature = identity.executionSignature;
  const arenaId = createArenaId(signature, input.data.requestId);
  const guidance = await getRecipeGuidance(identity, {
    recordLookup: false,
  });
  const learning =
    guidance.isOk()
      ? guidance.value
      : {
          source: "none" as const,
          activeStrategy: null,
          prior: null,
        };
  const preferredStrategy =
    learning.activeStrategy ?? learning.prior?.strategy ?? null;
  const triggered = await ResultAsync.fromPromise(
    tasks.trigger<typeof queryArenaTask>(
      "query-arena",
      {
        analysis: input.data.analysis,
        arenaId,
        signature,
        semanticFamilyHash: identity.semanticFamilyHash,
        learningSource: learning.source,
        priorStrategy: preferredStrategy,
        priorEvidenceCount: learning.prior?.evidenceCount ?? 0,
      },
      {
        idempotencyKey: arenaId,
        idempotencyKeyTTL: "1h",
        tags: [`arena:${arenaId}`, `analysis:${signature.slice(0, 24)}`],
        metadata: {
          phase: "queued",
          progress: 0,
          strategies: ["baseline", "prewhere"],
          learningSource: learning.source,
          priorStrategy: preferredStrategy,
          priorEvidenceCount: learning.prior?.evidenceCount ?? 0,
          dataset:
            input.data.analysis.kind === "semantic"
              ? input.data.analysis.request.plan.dataset
              : input.data.analysis.request.dataset,
          completedCandidates: 0,
          trialEvents: [],
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
      semanticFamilyHash: identity.semanticFamilyHash,
      learningSource: learning.source,
      priorStrategy: preferredStrategy,
      priorEvidenceCount: learning.prior?.evidenceCount ?? 0,
    }),
    { status: 202 },
  );
}
