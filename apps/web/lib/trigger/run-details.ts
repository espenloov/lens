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
