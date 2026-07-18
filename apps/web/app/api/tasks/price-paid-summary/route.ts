import type { pricePaidSummaryTask } from "@/src/trigger/price-paid-summary";
import { tasks } from "@trigger.dev/sdk";
import { ResultAsync } from "neverthrow";

type ScheduleSummaryError = {
  readonly type: "schedule_summary_error";
  readonly message: string;
  readonly cause: unknown;
};

export async function POST() {
  const scheduled = await ResultAsync.fromPromise(
    tasks.trigger<typeof pricePaidSummaryTask>("price-paid-summary", {
      source: "web",
    }),
    (cause): ScheduleSummaryError => ({
      type: "schedule_summary_error",
      message: "Unable to schedule the Price Paid summary",
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
