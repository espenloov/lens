"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import {
  queryArenaSnapshotSchema,
  type QueryArenaRequest,
  type QueryArenaSnapshot,
} from "./contracts";
import {
  startQueryArena,
  type QueryArenaClientError,
} from "./client";

export function useQueryArena(analysis: QueryArenaRequest) {
  const [snapshot, setSnapshot] = useState<QueryArenaSnapshot | null>(null);
  const [streamError, setStreamError] = useState<QueryArenaClientError | null>(
    null,
  );
  const start = useQuery({
    queryKey: ["query-arena", analysis],
    queryFn: async () => startQueryArena(analysis),
    retry: false,
    staleTime: Number.POSITIVE_INFINITY,
  });
  const started = start.data?.isOk() === true ? start.data.value : null;

  useEffect(() => {
    if (started === null) {
      return;
    }

    const source = new EventSource(
      `/api/query-arena/${encodeURIComponent(started.runId)}/events`,
    );

    source.onmessage = (event) => {
      let payload: unknown;

      try {
        payload = JSON.parse(event.data as string) as unknown;
      } catch (cause) {
        setStreamError({
          type: "query_arena_client_error",
          message: "The performance race returned malformed data",
          cause,
        });
        source.close();
        return;
      }

      const parsed = queryArenaSnapshotSchema.safeParse(payload);

      if (!parsed.success) {
        setStreamError({
          type: "query_arena_client_error",
          message: "The performance race returned an invalid update",
          cause: parsed.error,
        });
        source.close();
        return;
      }

      setSnapshot(parsed.data);
      setStreamError(null);

      if (
        parsed.data.status === "completed" ||
        parsed.data.status === "failed"
      ) {
        source.close();
      }
    };

    source.onerror = (cause) => {
      setStreamError({
        type: "query_arena_client_error",
        message: "Live performance updates were interrupted",
        cause,
      });
    };

    return () => source.close();
  }, [started]);

  const startError =
    start.data?.isErr() === true ? start.data.error : null;

  return {
    runId: started?.runId ?? null,
    snapshot,
    error: startError ?? streamError,
    isStarting: start.isPending,
  };
}
