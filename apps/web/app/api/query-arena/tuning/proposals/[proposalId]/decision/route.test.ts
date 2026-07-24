import { okAsync } from "neverthrow";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSource: vi.fn(),
  eligibility: vi.fn(),
  getProposal: vi.fn(),
  decideProposal: vi.fn(),
  trigger: vi.fn(),
}));

vi.mock("@trigger.dev/sdk", () => ({
  tasks: {
    trigger: mocks.trigger,
  },
}));

vi.mock("../../../../../../../lib/data-sources/access", () => ({
  authorizeDataSourceMutation: () => ({
    isErr: () => false,
  }),
}));

vi.mock("../../../../../../../lib/data-sources/registry", () => ({
  getAnalysisDataSource: mocks.getSource,
}));

vi.mock("../../../../../../../lib/query-arena/tuning/policy", () => ({
  evaluateTuningEligibility: mocks.eligibility,
}));

vi.mock("../../../../../../../lib/query-arena/tuning/repository", () => ({
  getTuningProposal: mocks.getProposal,
  decideTuningProposal: mocks.decideProposal,
}));

import { BUILTIN_DATA_SOURCE } from "../../../../../../../lib/data-sources/builtin";
import {
  tuningProposalSchema,
  type TuningProposal,
} from "../../../../../../../lib/query-arena/tuning/contracts";

import { POST } from "./route";

const proposalId = "06ec501d-e072-4f19-a3a8-18a843d41781";

function proposal(state: TuningProposal["state"]): TuningProposal {
  return tuningProposalSchema.parse({
    id: proposalId,
    state,
    dataset: "uk_price_paid",
    datasetVersion: 1,
    database: "default",
    table: "pp_complete",
    template: {
      kind: "ordered_projection_v1",
      timeKey: "date",
      dimensionKeys: ["town"],
    },
    physicalColumns: ["date", "town"],
    evidence: {
      analysisSignature: "a".repeat(64),
      semanticFamilyHash: "b".repeat(64),
      observedArenas: 3,
      verifiedTrials: 9,
      p95ServerElapsedMs: 400,
      medianRowsRead: 28_919_900,
      firstObservedAt: "2026-07-20T10:00:00.000Z",
      lastObservedAt: "2026-07-23T10:00:00.000Z",
    },
    validation: {
      valid: true,
      sourceExists: true,
      mergeTreeFamily: true,
      columnsExist: true,
      projectionExists: false,
      checkedColumns: ["date", "town"],
      engine: "MergeTree",
      sourceBytes: 1_000_000,
      messages: ["Validation passed"],
    },
    estimate: {
      method: "ordered_projection_heuristic_v1",
      estimatedStorageBytes: {
        lower: 700_000,
        upper: 1_300_000,
      },
      predictedSpeedup: {
        lower: 1.2,
        upper: 6,
      },
      confidence: "low_until_reraced",
    },
    ddl: {
      projectionName: "lens_ordered_1234",
      add: "ALTER TABLE `default`.`pp_complete` ADD PROJECTION",
      materialize:
        "ALTER TABLE `default`.`pp_complete` MATERIALIZE PROJECTION",
      rollback: "ALTER TABLE `default`.`pp_complete` DROP PROJECTION",
      digest: "c".repeat(64),
    },
    approvedBy: state === "approved" ? "Espen van Ingen" : null,
    rejectionReason: null,
    failureMessage: null,
    createdAt: "2026-07-23T10:00:00.000Z",
    updatedAt: "2026-07-23T10:00:00.000Z",
  });
}

function request(): Request {
  return new Request(
    `https://lens.example/api/query-arena/tuning/proposals/${proposalId}/decision`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://lens.example",
      },
      body: JSON.stringify({
        decision: "approve",
        approver: "Espen van Ingen",
      }),
    },
  );
}

const context = {
  params: Promise.resolve({ proposalId }),
};

describe("POST physical tuning decision", () => {
  beforeEach(() => {
    mocks.getSource.mockReset();
    mocks.eligibility.mockReset();
    mocks.getProposal.mockReset();
    mocks.decideProposal.mockReset();
    mocks.trigger.mockReset();

    mocks.getSource.mockReturnValue(okAsync(BUILTIN_DATA_SOURCE));
    mocks.getProposal.mockReturnValue(okAsync(proposal("validated")));
    mocks.eligibility.mockReturnValue({
      eligible: true,
      managed: true,
      writable: true,
      executionEnabled: true,
      reason: "Enabled",
    });
  });

  it("keeps the proposal validated while physical execution is disabled", async () => {
    mocks.eligibility.mockReturnValue({
      eligible: true,
      managed: true,
      writable: true,
      executionEnabled: false,
      reason: "Execution disabled",
    });

    const response = await POST(request(), context);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.proposal.state).toBe("validated");
    expect(body.execution.status).toBe("not_requested");
    expect(mocks.decideProposal).not.toHaveBeenCalled();
    expect(mocks.trigger).not.toHaveBeenCalled();
  });

  it("keeps a recorded approval retryable when Trigger.dev cannot queue the task", async () => {
    mocks.decideProposal.mockReturnValue(okAsync(proposal("approved")));
    mocks.trigger.mockRejectedValue(new Error("Trigger.dev unavailable"));

    const response = await POST(request(), context);

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      message: expect.stringContaining("can be retried safely"),
    });
  });

  it("retries an already approved proposal with the same idempotency key", async () => {
    mocks.getProposal.mockReturnValue(okAsync(proposal("approved")));
    mocks.trigger.mockResolvedValue({ id: "run_123" });

    const response = await POST(request(), context);
    const body = await response.json();

    expect(response.status).toBe(202);
    expect(body.execution).toEqual({
      status: "queued",
      runId: "run_123",
    });
    expect(mocks.decideProposal).not.toHaveBeenCalled();
    expect(mocks.trigger).toHaveBeenCalledWith(
      "physical-tuning",
      { proposalId },
      expect.objectContaining({
        idempotencyKey: `physical-tuning:${proposalId}`,
      }),
    );
  });

});
