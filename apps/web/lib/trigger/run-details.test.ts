import { describe, expect, it } from "vitest";

import {
  isTerminalTriggerRun,
  type TriggerRunDetails,
} from "./run-details";

function run(
  status: string,
  finishedAt: string | null = null,
): TriggerRunDetails {
  return {
    runId: "run_123",
    status,
    taskIdentifier: "property-agent",
    version: "1",
    createdAt: "2026-07-23T12:00:00.000Z",
    startedAt: "2026-07-23T12:00:01.000Z",
    finishedAt,
    durationMs: 1_000,
    costInCents: null,
    attemptCount: 1,
    attempts: [],
  };
}

describe("isTerminalTriggerRun", () => {
  it("keeps active Trigger.dev runs eligible for refresh", () => {
    expect(isTerminalTriggerRun(null)).toBe(false);
    expect(isTerminalTriggerRun(run("EXECUTING"))).toBe(false);
  });

  it("recognizes terminal statuses and completion timestamps", () => {
    expect(isTerminalTriggerRun(run("COMPLETED"))).toBe(true);
    expect(isTerminalTriggerRun(run("FAILED"))).toBe(true);
    expect(
      isTerminalTriggerRun(
        run("EXECUTING", "2026-07-23T12:00:02.000Z"),
      ),
    ).toBe(true);
  });
});
