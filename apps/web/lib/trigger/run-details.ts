export type TriggerRunAttempt = {
  readonly number: number;
  readonly status: string;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
  readonly errorMessage: string | null;
};

export type TriggerRunDetails = {
  readonly runId: string;
  readonly status: string;
  readonly taskIdentifier: string;
  readonly version: string | null;
  readonly createdAt: string;
  readonly startedAt: string | null;
  readonly finishedAt: string | null;
  readonly durationMs: number;
  readonly costInCents: number | null;
  readonly attemptCount: number;
  readonly attempts: readonly TriggerRunAttempt[];
};

const TERMINAL_TRIGGER_STATUSES = new Set([
  "CANCELED",
  "COMPLETED",
  "CRASHED",
  "FAILED",
  "SYSTEM_FAILURE",
  "TIMED_OUT",
]);

export function isTerminalTriggerRun(
  run: TriggerRunDetails | null,
): boolean {
  return (
    run !== null &&
    (run.finishedAt !== null ||
      TERMINAL_TRIGGER_STATUSES.has(run.status.toUpperCase()))
  );
}
