import { randomUUID } from "node:crypto";

import { errAsync, okAsync, ResultAsync } from "neverthrow";
import { z } from "zod";

import { getPostgresClient } from "../../postgres/client";

import {
  queryArenaRequestSchema,
} from "../contracts";
import {
  tuningProjectionDdlSchema,
  tuningImpactEstimateSchema,
  tuningProposalSchema,
  tuningTemplateSchema,
  tuningValidationSchema,
  type TuningEvidence,
  type TuningImpactEstimate,
  type TuningProjectionDdl,
  type TuningProposal,
  type TuningProposalState,
  type TuningTemplate,
  type TuningValidation,
} from "./contracts";

const proposalRowsSchema = z.array(
  z.object({
    id: z.string(),
    state: z.string(),
    dataset_slug: z.string(),
    dataset_version: z.coerce.number().int().positive(),
    source_database: z.string(),
    source_table: z.string(),
    analysis: queryArenaRequestSchema.nullable().optional(),
    template: tuningTemplateSchema,
    physical_columns: z.array(z.string()),
    evidence: z.unknown(),
    validation: tuningValidationSchema,
    estimate: tuningImpactEstimateSchema,
    ddl: tuningProjectionDdlSchema,
    approved_by: z.string().nullable(),
    rejection_reason: z.string().nullable(),
    failure_message: z.string().nullable(),
    rerace_run_id: z.string().nullable().optional(),
    created_at: z.string(),
    updated_at: z.string(),
  }),
);

export type TuningRepositoryError = {
  readonly type: "tuning_repository_error";
  readonly message: string;
  readonly cause: unknown;
};

export type NewTuningProposal = {
  readonly dataset: string;
  readonly datasetVersion: number;
  readonly database: string;
  readonly table: string;
  readonly analysis: z.infer<typeof queryArenaRequestSchema>;
  readonly template: TuningTemplate;
  readonly physicalColumns: readonly string[];
  readonly evidence: TuningEvidence;
  readonly validation: TuningValidation;
  readonly estimate: TuningImpactEstimate;
  readonly ddl: TuningProjectionDdl;
};

function repositoryError(cause: unknown): TuningRepositoryError {
  return {
    type: "tuning_repository_error",
    message:
      cause instanceof Error
        ? cause.message
        : "The physical tuning registry is unavailable",
    cause,
  };
}

function parseRows(rows: unknown): ResultAsync<TuningProposal[], TuningRepositoryError> {
  const parsed = proposalRowsSchema.safeParse(rows);

  if (!parsed.success) {
    return errAsync(repositoryError(parsed.error));
  }

  const proposals = parsed.data.map((row) =>
    tuningProposalSchema.parse({
      id: row.id,
      state: row.state,
      analysis: row.analysis ?? null,
      dataset: row.dataset_slug,
      datasetVersion: row.dataset_version,
      database: row.source_database,
      table: row.source_table,
      template: row.template,
      physicalColumns: row.physical_columns,
      evidence: row.evidence,
      validation: row.validation,
      estimate: row.estimate,
      ddl: row.ddl,
      approvedBy: row.approved_by,
      rejectionReason: row.rejection_reason,
      failureMessage: row.failure_message,
      reraceRunId: row.rerace_run_id ?? null,
      createdAt: new Date(row.created_at).toISOString(),
      updatedAt: new Date(row.updated_at).toISOString(),
    }),
  );

  return okAsync(proposals);
}

function selectProposalQuery(sql: NonNullable<ReturnType<typeof getPostgresClient>>, id: string) {
  return sql`
    SELECT
      id,
      state,
      dataset_slug,
      dataset_version,
      source_database,
      source_table,
      analysis,
      template,
      physical_columns,
      evidence,
      validation,
      estimate,
      ddl,
      approved_by,
      rejection_reason,
      failure_message,
      rerace_run_id,
      created_at::TEXT AS created_at,
      updated_at::TEXT AS updated_at
    FROM physical_tuning_proposals
    WHERE id = ${id}
    LIMIT 1
  `;
}

export function createValidatedProposal(
  input: NewTuningProposal,
): ResultAsync<TuningProposal, TuningRepositoryError> {
  const sql = getPostgresClient();

  if (sql === null) {
    return errAsync(
      repositoryError(
        new Error("PostgreSQL is required for physical tuning proposals"),
      ),
    );
  }

  const id = randomUUID();

  return ResultAsync.fromPromise(
    sql.begin(async (transaction) => {
      await transaction`
        INSERT INTO physical_tuning_proposals
          (id, state, dataset_slug, dataset_version, source_database,
           source_table, analysis, template, physical_columns, evidence,
           validation, estimate, ddl)
        VALUES
          (${id}, 'validated', ${input.dataset}, ${input.datasetVersion},
           ${input.database}, ${input.table}, ${transaction.json(input.analysis)},
           ${transaction.json(input.template)},
           ${transaction.json([...input.physicalColumns])},
           ${transaction.json(input.evidence)},
           ${transaction.json(input.validation)},
           ${transaction.json(input.estimate)},
           ${transaction.json(input.ddl)})
      `;
      await transaction`
        INSERT INTO physical_tuning_events (proposal_id, state, detail)
        VALUES (${id}, 'validated', 'Proposal passed read-only validation')
      `;
    }),
    repositoryError,
  ).andThen(() => getTuningProposal(id));
}

export function getTuningProposal(
  id: string,
): ResultAsync<TuningProposal, TuningRepositoryError> {
  const sql = getPostgresClient();

  if (sql === null) {
    return errAsync(
      repositoryError(
        new Error("PostgreSQL is required for physical tuning proposals"),
      ),
    );
  }

  return ResultAsync.fromPromise(selectProposalQuery(sql, id), repositoryError)
    .andThen(parseRows)
    .andThen((proposals) =>
      proposals[0] === undefined
        ? errAsync(repositoryError(new Error("Tuning proposal not found")))
        : okAsync(proposals[0]),
    );
}

export function decideTuningProposal(
  id: string,
  decision:
    | { readonly kind: "approve"; readonly approver: string }
    | {
        readonly kind: "reject";
        readonly approver: string;
        readonly reason: string;
      },
): ResultAsync<TuningProposal, TuningRepositoryError> {
  const sql = getPostgresClient();

  if (sql === null) {
    return errAsync(
      repositoryError(
        new Error("PostgreSQL is required for physical tuning proposals"),
      ),
    );
  }

  const state = decision.kind === "approve" ? "approved" : "rejected";
  const rejectionReason =
    decision.kind === "reject" ? decision.reason : null;

  return ResultAsync.fromPromise(
    sql.begin(async (transaction) => {
      const updated = await transaction<{ id: string }[]>`
        UPDATE physical_tuning_proposals
        SET
          state = ${state},
          approved_by = ${decision.approver},
          rejection_reason = ${rejectionReason},
          updated_at = NOW()
        WHERE id = ${id}
          AND state = 'validated'
        RETURNING id
      `;

      if (updated.length !== 1) {
        throw new Error(
          "Only a validated proposal can receive a human decision",
        );
      }

      await transaction`
        INSERT INTO physical_tuning_events
          (proposal_id, state, actor, detail)
        VALUES
          (${id}, ${state}, ${decision.approver},
           ${decision.kind === "approve" ? "Human approval recorded" : rejectionReason})
      `;
    }),
    repositoryError,
  ).andThen(() => getTuningProposal(id));
}

export function transitionTuningProposal(
  id: string,
  expected: TuningProposalState,
  next: TuningProposalState,
  detail: string,
  failureMessage: string | null = null,
  reraceRunId: string | null = null,
): ResultAsync<TuningProposal, TuningRepositoryError> {
  const sql = getPostgresClient();

  if (sql === null) {
    return errAsync(
      repositoryError(
        new Error("PostgreSQL is required for physical tuning proposals"),
      ),
    );
  }

  return ResultAsync.fromPromise(
    sql.begin(async (transaction) => {
      const updated = await transaction<{ id: string }[]>`
        UPDATE physical_tuning_proposals
        SET
          state = ${next},
          failure_message = ${failureMessage},
          rerace_run_id = COALESCE(${reraceRunId}, rerace_run_id),
          updated_at = NOW()
        WHERE id = ${id}
          AND state = ${expected}
        RETURNING id
      `;

      if (updated.length !== 1) {
        throw new Error(
          `The tuning proposal cannot move from ${expected} to ${next}`,
        );
      }

      await transaction`
        INSERT INTO physical_tuning_events (proposal_id, state, detail)
        VALUES (${id}, ${next}, ${detail})
      `;
    }),
    repositoryError,
  ).andThen(() => getTuningProposal(id));
}
