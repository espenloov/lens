import { z } from "zod";

import {
  clickHouseIdentifierSchema,
  datasetSlugSchema,
} from "../../data-sources/contracts";
import { semanticKeySchema } from "../../data-sources/semantic";
import { queryArenaRequestSchema } from "../contracts";

export const tuningProposalStateSchema = z.enum([
  "validated",
  "approved",
  "rejected",
  "applying",
  "applied",
  "failed",
  "rolled_back",
]);

export const orderedProjectionTemplateSchema = z.object({
  kind: z.literal("ordered_projection_v1"),
  timeKey: semanticKeySchema,
  dimensionKeys: z
    .array(semanticKeySchema)
    .min(1)
    .max(3)
    .refine((keys) => new Set(keys).size === keys.length, {
      message: "Projection dimensions must be unique",
    }),
});

export const tuningTemplateSchema = orderedProjectionTemplateSchema;

export const tuningEvidenceSchema = z.object({
  analysisSignature: z.string().regex(/^[a-f0-9]{64}$/),
  semanticFamilyHash: z.string().regex(/^[a-f0-9]{64}$/),
  observedArenas: z.number().int().nonnegative(),
  verifiedTrials: z.number().int().nonnegative(),
  p95ServerElapsedMs: z.number().nonnegative().nullable(),
  medianRowsRead: z.number().int().nonnegative().nullable(),
  firstObservedAt: z.iso.datetime().nullable(),
  lastObservedAt: z.iso.datetime().nullable(),
});

export const tuningProjectionDdlSchema = z.object({
  projectionName: clickHouseIdentifierSchema,
  add: z.string().min(1),
  materialize: z.string().min(1),
  rollback: z.string().min(1),
  digest: z.string().regex(/^[a-f0-9]{64}$/),
});

export const tuningValidationSchema = z.object({
  valid: z.boolean(),
  sourceExists: z.boolean(),
  mergeTreeFamily: z.boolean(),
  columnsExist: z.boolean(),
  projectionExists: z.boolean(),
  checkedColumns: z.array(clickHouseIdentifierSchema).min(2).max(4),
  engine: z.string().nullable(),
  sourceBytes: z.number().int().nonnegative().nullable(),
  messages: z.array(z.string().min(1).max(240)).min(1),
});

export const tuningImpactEstimateSchema = z.object({
  method: z.literal("ordered_projection_heuristic_v1"),
  estimatedStorageBytes: z.object({
    lower: z.number().int().nonnegative(),
    upper: z.number().int().nonnegative(),
  }).nullable(),
  predictedSpeedup: z.object({
    lower: z.number().positive(),
    upper: z.number().positive(),
  }),
  confidence: z.literal("low_until_reraced"),
});

export const createTuningProposalSchema = z.object({
  analysis: queryArenaRequestSchema,
  template: tuningTemplateSchema.optional(),
});

export const decideTuningProposalSchema = z.discriminatedUnion("decision", [
  z.object({
    decision: z.literal("approve"),
    approver: z.string().trim().min(2).max(80),
  }),
  z.object({
    decision: z.literal("reject"),
    approver: z.string().trim().min(2).max(80),
    reason: z.string().trim().min(3).max(320),
  }),
]);

export const tuningProposalSchema = z.object({
  id: z.uuid(),
  state: tuningProposalStateSchema,
  analysis: queryArenaRequestSchema.nullable().default(null),
  dataset: datasetSlugSchema,
  datasetVersion: z.number().int().positive(),
  database: clickHouseIdentifierSchema,
  table: clickHouseIdentifierSchema,
  template: tuningTemplateSchema,
  physicalColumns: z.array(clickHouseIdentifierSchema).min(2).max(4),
  evidence: tuningEvidenceSchema,
  validation: tuningValidationSchema,
  estimate: tuningImpactEstimateSchema,
  ddl: tuningProjectionDdlSchema,
  approvedBy: z.string().nullable(),
  rejectionReason: z.string().nullable(),
  failureMessage: z.string().nullable(),
  reraceRunId: z.string().min(1).nullable().default(null),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const tuningDecisionResponseSchema = z.object({
  proposal: tuningProposalSchema,
  execution: z.discriminatedUnion("status", [
    z.object({
      status: z.literal("not_requested"),
      reason: z.string().min(1),
    }),
    z.object({
      status: z.literal("queued"),
      runId: z.string().min(1),
    }),
  ]),
});

export const tuningTaskPayloadSchema = z.object({
  proposalId: z.uuid(),
});

export const tuningTaskResultSchema = z.object({
  proposalId: z.uuid(),
  state: z.enum(["applied", "rolled_back", "failed"]),
  projectionName: clickHouseIdentifierSchema,
  rollbackAttempted: z.boolean(),
  rollbackSucceeded: z.boolean().nullable(),
  reraceRunId: z.string().min(1).nullable(),
  completedAt: z.iso.datetime(),
});

export type TuningProposalState = z.infer<
  typeof tuningProposalStateSchema
>;
export type TuningTemplate = z.infer<typeof tuningTemplateSchema>;
export type TuningEvidence = z.infer<typeof tuningEvidenceSchema>;
export type TuningProjectionDdl = z.infer<typeof tuningProjectionDdlSchema>;
export type TuningValidation = z.infer<typeof tuningValidationSchema>;
export type TuningImpactEstimate = z.infer<
  typeof tuningImpactEstimateSchema
>;
export type TuningProposal = z.infer<typeof tuningProposalSchema>;
export type CreateTuningProposal = z.infer<
  typeof createTuningProposalSchema
>;
