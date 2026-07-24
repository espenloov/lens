"use client";

import axios from "axios";
import { ResultAsync } from "neverthrow";

import type { QueryArenaRequest } from "@/lib/query-arena/contracts";
import {
  tuningDecisionResponseSchema,
  tuningProposalSchema,
} from "@/lib/query-arena/tuning/contracts";

export type TuningClientError = {
  readonly type: "tuning_client_error";
  readonly message: string;
  readonly cause: unknown;
};

function clientError(cause: unknown): TuningClientError {
  const message =
    axios.isAxiosError<{ message?: string }>(cause)
      ? (cause.response?.data?.message ?? "Storage tuning is unavailable")
      : cause instanceof Error
        ? cause.message
        : "Storage tuning is unavailable";

  return {
    type: "tuning_client_error",
    message,
    cause,
  };
}

export function createTuningProposal(analysis: QueryArenaRequest) {
  return ResultAsync.fromPromise(
    axios.post<unknown>("/api/query-arena/tuning/proposals", { analysis }),
    clientError,
  ).andThen((response) =>
    ResultAsync.fromPromise(
      tuningProposalSchema.parseAsync(response.data),
      clientError,
    ),
  );
}

export function decideTuningProposal(
  proposalId: string,
  decision:
    | { readonly decision: "approve"; readonly approver: string }
    | {
        readonly decision: "reject";
        readonly approver: string;
        readonly reason: string;
      },
) {
  return ResultAsync.fromPromise(
    axios.post<unknown>(
      `/api/query-arena/tuning/proposals/${encodeURIComponent(proposalId)}/decision`,
      decision,
    ),
    clientError,
  ).andThen((response) =>
    ResultAsync.fromPromise(
      tuningDecisionResponseSchema.parseAsync(response.data),
      clientError,
    ),
  );
}
