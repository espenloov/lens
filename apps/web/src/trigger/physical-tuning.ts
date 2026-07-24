import { logger, metadata, schemaTask, tasks } from "@trigger.dev/sdk";

import { getAnalysisDataSource } from "@/lib/data-sources/registry";
import { getRecipeGuidance } from "@/lib/query-arena/recipe-registry";
import {
  createArenaId,
  createQueryArenaIdentity,
} from "@/lib/query-arena/signature";
import {
  tuningTaskPayloadSchema,
  tuningTaskResultSchema,
} from "@/lib/query-arena/tuning/contracts";
import { executeProjectionDdl } from "@/lib/query-arena/tuning/execution";
import { evaluateTuningEligibility } from "@/lib/query-arena/tuning/policy";
import { compileProjectionTemplate } from "@/lib/query-arena/tuning/projection";
import {
  getTuningProposal,
  transitionTuningProposal,
} from "@/lib/query-arena/tuning/repository";
import { validateProjectionProposal } from "@/lib/query-arena/tuning/validation";
import type { queryArenaTask } from "@/src/trigger/query-arena";

async function failApprovedProposal(
  proposalId: string,
  message: string,
): Promise<never> {
  await transitionTuningProposal(
    proposalId,
    "approved",
    "failed",
    "Guarded execution stopped before DDL",
    message,
  );
  throw new Error(message);
}

export const physicalTuningTask = schemaTask({
  id: "physical-tuning",
  schema: tuningTaskPayloadSchema,
  maxDuration: 1800,
  retry: {
    maxAttempts: 1,
  },

  run: async ({ proposalId }) => {
    await metadata.set("phase", "revalidating").set("progress", 0.2).flush();

    const proposal = await getTuningProposal(proposalId);

    if (proposal.isErr()) {
      throw new Error(proposal.error.message);
    }

    if (proposal.value.state !== "approved") {
      throw new Error("The proposal has not received human approval");
    }

    if (proposal.value.analysis === null) {
      return failApprovedProposal(
        proposalId,
        "This older proposal does not contain the typed analysis needed for a safe rerace",
      );
    }

    const identity = createQueryArenaIdentity(proposal.value.analysis);

    if (
      identity.executionSignature !==
        proposal.value.evidence.analysisSignature ||
      identity.semanticFamilyHash !==
        proposal.value.evidence.semanticFamilyHash
    ) {
      return failApprovedProposal(
        proposalId,
        "The stored analysis no longer matches the approved evidence",
      );
    }

    const source = await getAnalysisDataSource(
      proposal.value.dataset,
      proposal.value.datasetVersion,
    );

    if (source.isErr()) {
      return failApprovedProposal(proposalId, source.error.message);
    }

    const eligibility = evaluateTuningEligibility(source.value);

    if (!eligibility.eligible || !eligibility.executionEnabled) {
      return failApprovedProposal(proposalId, eligibility.reason);
    }

    const compiled = compileProjectionTemplate(
      source.value,
      proposal.value.template,
    );

    if (
      compiled.isErr() ||
      compiled.value.ddl.digest !== proposal.value.ddl.digest
    ) {
      return failApprovedProposal(
        proposalId,
        "The immutable dataset or projection template no longer matches the approved DDL",
      );
    }

    const validation = await validateProjectionProposal(
      source.value,
      compiled.value.physicalColumns,
      compiled.value.ddl,
    );

    if (validation.isErr() || !validation.value.valid) {
      return failApprovedProposal(
        proposalId,
        validation.isErr()
          ? validation.error.message
          : "Read-only validation no longer passes",
      );
    }

    const applying = await transitionTuningProposal(
      proposalId,
      "approved",
      "applying",
      "Trigger.dev started the approved ClickHouse projection",
    );

    if (applying.isErr()) {
      throw new Error(applying.error.message);
    }

    await metadata.set("phase", "materializing").set("progress", 0.55).flush();

    const execution = await executeProjectionDdl(proposal.value.ddl);
    let reraceRunId: string | null = null;

    if (execution.state === "applied") {
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
      const arenaId = createArenaId(
        identity.executionSignature,
        `physical-tuning:${proposalId}`,
      );
      const rerace = await tasks
        .trigger<typeof queryArenaTask>(
          "query-arena",
          {
            analysis: proposal.value.analysis,
            arenaId,
            signature: identity.executionSignature,
            semanticFamilyHash: identity.semanticFamilyHash,
            learningSource: learning.source,
            priorStrategy: preferredStrategy,
            priorEvidenceCount: learning.prior?.evidenceCount ?? 0,
          },
          {
            idempotencyKey: `physical-tuning-rerace:${proposalId}`,
            idempotencyKeyTTL: "24h",
            tags: [
              `tuning:${proposalId}`,
              `arena:${arenaId}`,
              `analysis:${identity.executionSignature.slice(0, 24)}`,
            ],
            metadata: {
              phase: "queued_after_storage_change",
              progress: 0,
              strategies: ["baseline", "prewhere"],
              learningSource: learning.source,
              priorStrategy: preferredStrategy,
              priorEvidenceCount: learning.prior?.evidenceCount ?? 0,
              dataset: proposal.value.dataset,
              completedCandidates: 0,
              trialEvents: [],
              candidateEvents: [],
            },
          },
        )
        .catch(() => null);

      reraceRunId = rerace?.id ?? null;

      if (reraceRunId === null) {
        logger.warn("Post-materialization Query Arena rerace was not queued", {
          proposalId,
        });
      }
    }

    const message =
      execution.state === "applied"
        ? reraceRunId === null
          ? "Projection materialized; the measured rerace still needs to be queued"
          : `Projection materialized and rerace ${reraceRunId} was queued`
        : execution.message;
    const transitioned = await transitionTuningProposal(
      proposalId,
      "applying",
      execution.state,
      message,
      execution.state === "applied" ? null : execution.message,
      reraceRunId,
    );

    if (transitioned.isErr()) {
      throw new Error(transitioned.error.message);
    }

    logger.info("Physical tuning task completed", {
      proposalId,
      state: execution.state,
      projection: proposal.value.ddl.projectionName,
      rollbackAttempted: execution.rollbackAttempted,
      rollbackSucceeded: execution.rollbackSucceeded,
      reraceRunId,
    });

    await metadata
      .set("phase", execution.state)
      .set("progress", 1)
      .flush();

    return tuningTaskResultSchema.parse({
      proposalId,
      state: execution.state,
      projectionName: proposal.value.ddl.projectionName,
      rollbackAttempted: execution.rollbackAttempted,
      rollbackSucceeded: execution.rollbackSucceeded,
      reraceRunId,
      completedAt: new Date().toISOString(),
    });
  },
});
