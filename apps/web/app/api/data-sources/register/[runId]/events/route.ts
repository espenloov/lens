import type { registerDataSourceTask } from "@/src/trigger/register-data-source";
import { runs } from "@trigger.dev/sdk";
import { z } from "zod";

import {
  registrationMetadataSchema,
  registrationResultSchema,
  registrationSnapshotSchema,
} from "@/lib/data-sources/contracts";
import { authorizeDataSourceRead } from "@/lib/data-sources/access";
import { registrationFailureMessage } from "@/lib/data-sources/registration-error";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const runIdSchema = z.string().regex(/^run_[A-Za-z0-9]+(?:\.[0-9]+)?$/);
const encoder = new TextEncoder();

type RouteContext = {
  readonly params: Promise<{ runId: string }>;
};

export async function GET(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  const access = authorizeDataSourceRead(request);

  if (access.isErr()) {
    return Response.json(access.error, { status: access.error.status });
  }

  const { runId: rawRunId } = await context.params;
  const runId = runIdSchema.safeParse(rawRunId);

  if (!runId.success) {
    return Response.json({ message: "The run ID is invalid" }, { status: 400 });
  }

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const publish = async () => {
        try {
          for await (const run of runs.subscribeToRun<typeof registerDataSourceTask>(
            runId.data,
            { signal: request.signal },
          )) {
            const metadata = registrationMetadataSchema.safeParse(run.metadata);
            const result = registrationResultSchema.safeParse(run.output);
            const status = run.isCompleted
              ? run.isSuccess
                ? "completed"
                : "failed"
              : run.isExecuting
                ? "running"
                : "queued";
            const snapshot = registrationSnapshotSchema.parse({
              status,
              metadata: metadata.success ? metadata.data : null,
              result: result.success ? result.data : null,
              error:
                run.isCompleted && !run.isSuccess
                  ? registrationFailureMessage(
                      run.error,
                      metadata.success ? metadata.data.phase : undefined,
                    )
                  : null,
            });

            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify(snapshot)}\n\n`),
            );

            if (run.isCompleted) {
              break;
            }
          }

          controller.close();
        } catch (cause) {
          if (!request.signal.aborted) {
            controller.error(cause);
          }
        }
      };

      void publish();
    },
  });

  return new Response(stream, {
    headers: {
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "Content-Type": "text/event-stream",
      "X-Accel-Buffering": "no",
    },
  });
}
