import { authorizeDataSourceMutation } from "@/lib/data-sources/access";
import { getAnalysisDataSource } from "@/lib/data-sources/registry";
import {
  createTuningProposalSchema,
  tuningProposalSchema,
} from "@/lib/query-arena/tuning/contracts";
import { validateTuningBenefit } from "@/lib/query-arena/tuning/benefit";
import { loadTuningEvidence } from "@/lib/query-arena/tuning/evidence";
import { estimateProjectionImpact } from "@/lib/query-arena/tuning/estimate";
import { evaluateTuningEligibility } from "@/lib/query-arena/tuning/policy";
import { compileProjectionTemplate } from "@/lib/query-arena/tuning/projection";
import { recommendOrderedProjection } from "@/lib/query-arena/tuning/recommendation";
import { createValidatedProposal } from "@/lib/query-arena/tuning/repository";
import { validateProjectionProposal } from "@/lib/query-arena/tuning/validation";
import { createQueryArenaIdentity } from "@/lib/query-arena/signature";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  const access = authorizeDataSourceMutation(request);

  if (access.isErr()) {
    return Response.json(access.error, { status: access.error.status });
  }

  const body = await request.json().catch(() => null);
  const input = createTuningProposalSchema.safeParse(body);

  if (!input.success) {
    return Response.json(
      { message: input.error.issues[0]?.message ?? "The proposal is invalid" },
      { status: 400 },
    );
  }

  const dataset =
    input.data.analysis.kind === "semantic"
      ? input.data.analysis.request.plan.dataset
      : input.data.analysis.request.dataset;
  const datasetVersion =
    input.data.analysis.kind === "semantic"
      ? input.data.analysis.request.plan.datasetVersion
      : input.data.analysis.request.datasetVersion ?? 1;
  const source = await getAnalysisDataSource(dataset, datasetVersion);

  if (source.isErr()) {
    return Response.json({ message: source.error.message }, { status: 404 });
  }

  const eligibility = evaluateTuningEligibility(source.value);

  if (!eligibility.eligible) {
    return Response.json(
      { message: eligibility.reason, eligibility },
      { status: 403 },
    );
  }

  let template = input.data.template;

  if (template === undefined) {
    const recommendation = recommendOrderedProjection(
      source.value,
      input.data.analysis,
    );

    if (recommendation.isErr()) {
      return Response.json(
        { message: recommendation.error.message },
        { status: 422 },
      );
    }

    template = recommendation.value;
  }

  const compiled = compileProjectionTemplate(source.value, template);

  if (compiled.isErr()) {
    return Response.json(
      { message: compiled.error.message },
      { status: 422 },
    );
  }

  const evidence = await loadTuningEvidence({
    ...createQueryArenaIdentity(input.data.analysis),
    dataset: source.value.slug,
    datasetVersion: source.value.version,
  });

  if (evidence.isErr()) {
    return Response.json(
      { message: evidence.error.message },
      { status: 503 },
    );
  }

  const benefit = validateTuningBenefit(evidence.value);

  if (benefit.isErr()) {
    return Response.json(
      { message: benefit.error.message, evidence: evidence.value },
      { status: 422 },
    );
  }

  const validation = await validateProjectionProposal(
    source.value,
    compiled.value.physicalColumns,
    compiled.value.ddl,
  );

  if (validation.isErr()) {
    return Response.json(
      { message: validation.error.message },
      { status: 503 },
    );
  }

  if (!validation.value.valid) {
    return Response.json(
      {
        message: "The projection template failed read-only validation",
        validation: validation.value,
      },
      { status: 422 },
    );
  }

  const proposal = await createValidatedProposal({
    dataset: source.value.slug,
    datasetVersion: source.value.version,
    database: source.value.database,
    table: source.value.table,
    analysis: input.data.analysis,
    template,
    physicalColumns: compiled.value.physicalColumns,
    evidence: evidence.value,
    validation: validation.value,
    estimate: estimateProjectionImpact(evidence.value, validation.value),
    ddl: compiled.value.ddl,
  });

  if (proposal.isErr()) {
    return Response.json(
      { message: proposal.error.message },
      { status: 503 },
    );
  }

  return Response.json(tuningProposalSchema.parse(proposal.value), {
    status: 201,
  });
}
