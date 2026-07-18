import type { clickHouseHealthTask } from "@/src/trigger/clickhouse-health";
import { tasks } from "@trigger.dev/sdk";
import { ResultAsync } from "neverthrow";

type ScheduleHealthCheckError = {
  readonly type: "schedule_health_check_error";
  readonly message: string;
  readonly cause: unknown;
};

export async function POST() {
  const scheduled = await ResultAsync.fromPromise(
    tasks.trigger<typeof clickHouseHealthTask>("clickhouse-health", {
      source: "web",
    }),
    (cause): ScheduleHealthCheckError => ({
      type: "schedule_health_check_error",
      message: "unable to schedule the clickhouse health check",
      cause,
    }),
  );

  if (scheduled.isErr()) {
    return Response.json(
      {
        error: {
          type: scheduled.error.type,
          message: scheduled.error.message,
        },
      },
      { status: 503 },
    );
  }

  return Response.json(
    {
      runId: scheduled.value.id,
    },
    { status: 202 },
  );
}
