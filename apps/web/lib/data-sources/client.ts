"use client";

import axios from "axios";
import { ResultAsync } from "neverthrow";

import {
  dataSourceListSchema,
  dataSourceDiscoverySchema,
  dataSourceSummarySchema,
  inspectedRelationSchema,
  registrationSnapshotSchema,
  registrationStartResponseSchema,
  type RegisterDataSourceInput,
} from "./contracts";

export type DataSourceClientError = {
  readonly type: "data_source_client_error";
  readonly message: string;
  readonly cause: unknown;
};

function clientError(cause: unknown): DataSourceClientError {
  let message = cause instanceof Error ? cause.message : "The data source request failed";

  if (axios.isAxiosError(cause)) {
    const responseMessage = (cause.response?.data as { message?: unknown } | undefined)
      ?.message;
    message =
      typeof responseMessage === "string"
        ? responseMessage
        : "The data source service is unavailable";
  }

  return {
    type: "data_source_client_error",
    message,
    cause,
  };
}

function authorizationHeaders(token: string): Record<string, string> {
  const trimmed = token.trim();
  return trimmed.length === 0
    ? {}
    : { Authorization: `Bearer ${trimmed}` };
}

export function fetchDataSources() {
  return ResultAsync.fromPromise(
    axios.get<unknown>("/api/data-sources"),
    clientError,
  ).andThen((response) =>
    ResultAsync.fromPromise(
      dataSourceListSchema.parseAsync(response.data),
      clientError,
    ),
  );
}

export function discoverDataSourceTables(database?: string) {
  return ResultAsync.fromPromise(
    axios.get<unknown>("/api/data-sources/discovery", {
      params: database === undefined ? undefined : { database },
    }),
    clientError,
  ).andThen((response) =>
    ResultAsync.fromPromise(
      dataSourceDiscoverySchema.parseAsync(response.data),
      clientError,
    ),
  );
}

export function activateDataSourceSession(adminToken: string) {
  return ResultAsync.fromPromise(
    axios.post<unknown>(
      "/api/data-sources/session",
      {},
      { headers: authorizationHeaders(adminToken) },
    ),
    clientError,
  );
}

export function inspectDataSource(
  database: string,
  table: string,
  adminToken: string,
) {
  return ResultAsync.fromPromise(
    axios.post<unknown>(
      "/api/data-sources/inspect",
      { database, table },
      { headers: authorizationHeaders(adminToken) },
    ),
    clientError,
  ).andThen((response) =>
    ResultAsync.fromPromise(
      inspectedRelationSchema.parseAsync(response.data),
      clientError,
    ),
  );
}

export function selectRegisteredDataSource(
  slug: string,
  adminToken: string,
) {
  return ResultAsync.fromPromise(
    axios.patch<unknown>(
      "/api/data-sources",
      { slug },
      { headers: authorizationHeaders(adminToken) },
    ),
    clientError,
  ).andThen((response) =>
    ResultAsync.fromPromise(
      dataSourceSummarySchema.parseAsync(response.data),
      clientError,
    ),
  );
}

export function deleteRegisteredDataSource(
  slug: string,
  adminToken = "",
) {
  return ResultAsync.fromPromise(
    axios.delete<unknown>("/api/data-sources", {
      data: { slug },
      headers: authorizationHeaders(adminToken),
    }),
    clientError,
  ).andThen((response) =>
    ResultAsync.fromPromise(
      dataSourceSummarySchema.parseAsync(response.data),
      clientError,
    ),
  );
}

export function startDataSourceRegistration(
  input: RegisterDataSourceInput,
  adminToken: string,
) {
  return ResultAsync.fromPromise(
    axios.post<unknown>("/api/data-sources/register", input, {
      headers: authorizationHeaders(adminToken),
    }),
    clientError,
  ).andThen((response) =>
    ResultAsync.fromPromise(
      registrationStartResponseSchema.parseAsync(response.data),
      clientError,
    ),
  );
}

export function subscribeToDataSourceRegistration(
  runId: string,
  onSnapshot: (
    snapshot: ReturnType<typeof registrationSnapshotSchema.parse>,
  ) => void,
  onError: (error: DataSourceClientError) => void,
): () => void {
  const source = new EventSource(
    `/api/data-sources/register/${encodeURIComponent(runId)}/events`,
  );

  source.onmessage = (event) => {
    try {
      const snapshot = registrationSnapshotSchema.parse(
        JSON.parse(event.data as string) as unknown,
      );
      onSnapshot(snapshot);

      if (snapshot.status === "completed" || snapshot.status === "failed") {
        source.close();
      }
    } catch (cause) {
      onError(clientError(cause));
      source.close();
    }
  };

  source.onerror = (cause) => {
    onError(clientError(cause));
    source.close();
  };

  return () => source.close();
}
