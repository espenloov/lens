import { tasks } from "@trigger.dev/sdk";
import { z } from "zod";

import type { physicalTuningTask } from "../../../../../../../src/trigger/physical-tuning";
import { authorizeDataSourceMutation } from "../../../../../../../lib/data-sources/access";
import { getAnalysisDataSource } from "../../../../../../../lib/data-sources/registry";
import {
  decideTuningProposalSchema,
  tuningDecisionResponseSchema,
} from "../../../../../../../lib/query-arena/tuning/contracts";
import { evaluateTuningEligibility } from "../../../../../../../lib/query-arena/tuning/policy";
import {
  decideTuningProposal,
  getTuningProposal,
} from "../../../../../../../lib/query-arena/tuning/repository";

export const runtime = "nodejs";

const proposalIdSchema = z.uuid();

type RouteContext = {
  readonly params: Promise<{ proposalId: string }>;
};

export async function POST(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  const access = authorizeDataSourceMutation(request);

  if (access.isErr()) {
    return Response.json(access.error, { status: access.error.status });
  }

  const { proposalId: rawProposalId } = await context.params;
  const proposalId = proposalIdSchema.safeParse(rawProposalId);

  if (!proposalId.success) {
    return Response.json({ message: "The proposal ID is invalid" }, {
      status: 400,
    });
  }

  const body = await request.json().catch(() => null);
  const input = decideTuningProposalSchema.safeParse(body);

  if (!input.success) {
    return Response.json(
      { message: input.error.issues[0]?.message ?? "The decision is invalid" },
      { status: 400 },
    );
  }

  const current = await getTuningProposal(proposalId.data);

  if (current.isErr()) {
    return Response.json({ message: current.error.message }, { status: 404 });
  }

  const source = await getAnalysisDataSource(
    current.value.dataset,
    current.value.datasetVersion,
  );

  if (source.isErr()) {
    return Response.json({ message: source.error.message }, { status: 409 });
  }

  const eligibility = evaluateTuningEligibility(source.value);

  if (!eligibility.eligible) {
    return Response.json(
      { message: eligibility.reason, eligibility },
      { status: 403 },
    );
  }

  if (input.data.decision === "reject") {
    const decided = await decideTuningProposal(proposalId.data, {
      kind: "reject",
      approver: input.data.approver,
      reason: input.data.reason,
    });

    if (decided.isErr()) {
      return Response.json(
        { message: decided.error.message },
        { status: 409 },
      );
    }

    return Response.json(
      tuningDecisionResponseSchema.parse({
        proposal: decided.value,
        execution: {
          status: "not_requested",
          reason: "The proposal was rejected",
        },
      }),
    );
  }

  if (!eligibility.executionEnabled) {
    if (current.value.state !== "validated") {
      return Response.json(
        { message: "Only a validated proposal can receive approval" },
        { status: 409 },
      );
    }

    return Response.json(
      tuningDecisionResponseSchema.parse({
        proposal: current.value,
        execution: {
          status: "not_requested",
          reason:
            "Execution is disabled, so the proposal remains validated and can be approved later",
        },
      }),
    );
  }

  const approved =
    current.value.state === "approved"
      ? current
      : current.value.state === "validated"
        ? await decideTuningProposal(proposalId.data, {
            kind: "approve",
            approver: input.data.approver,
          })
        : null;

  if (approved === null || approved.isErr()) {
    return Response.json(
      {
        message:
          approved === null
            ? "Only a validated or approved proposal can be queued"
            : approved.error.message,
      },
      { status: 409 },
    );
  }

  const triggered = await tasks.trigger<typeof physicalTuningTask>(
    "physical-tuning",
    { proposalId: proposalId.data },
    {
      idempotencyKey: `physical-tuning:${proposalId.data}`,
      idempotencyKeyTTL: "24h",
      tags: [
        `tuning:${proposalId.data}`,
        `dataset:${approved.value.dataset}`,
      ],
      metadata: {
        phase: "approved",
        progress: 0.1,
        projection: approved.value.ddl.projectionName,
      },
    },
  ).catch(() => null);

  if (triggered === null) {
    return Response.json(
      {
        message:
          "The guarded Trigger.dev task could not be queued; the recorded approval can be retried safely",
      },
      { status: 503 },
    );
  }

  return Response.json(
    tuningDecisionResponseSchema.parse({
      proposal: approved.value,
      execution: {
        status: "queued",
        runId: triggered.id,
      },
    }),
    { status: 202 },
  );
}
