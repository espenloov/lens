"use client";

import axios from "axios";
import { ResultAsync } from "neverthrow";

import {
  queryArenaStartResponseSchema,
  type QueryArenaRequest,
  type QueryArenaSnapshot,
} from "./contracts";

export type QueryArenaClientError = {
  readonly type: "query_arena_client_error";
  readonly message: string;
  readonly cause: unknown;
};

function toClientError(cause: unknown): QueryArenaClientError {
  return {
    type: "query_arena_client_error",
    message: axios.isAxiosError(cause)
      ? "The performance race could not be started"
      : cause instanceof Error
        ? cause.message
        : "The performance race failed",
    cause,
  };
}

export function startQueryArena(analysis: QueryArenaRequest) {
  return ResultAsync.fromPromise(
    axios.post<unknown>("/api/query-arena", { analysis }),
    toClientError,
  ).andThen((response) =>
    ResultAsync.fromPromise(
      queryArenaStartResponseSchema.parseAsync(response.data),
      toClientError,
    ),
  );
}

export type QueryArenaClientState = {
  readonly runId: string | null;
  readonly snapshot: QueryArenaSnapshot | null;
  readonly error: QueryArenaClientError | null;
};
