import { ResultAsync } from "neverthrow";

import { getClickHouseClient } from "../../clickhouse/client";

import type { TuningProjectionDdl } from "./contracts";

export type ProjectionExecutionResult =
  | {
      readonly state: "applied";
      readonly rollbackAttempted: false;
      readonly rollbackSucceeded: null;
    }
  | {
      readonly state: "rolled_back" | "failed";
      readonly rollbackAttempted: boolean;
      readonly rollbackSucceeded: boolean | null;
      readonly message: string;
    };

export async function executeProjectionDdl(
  ddl: TuningProjectionDdl,
): Promise<ProjectionExecutionResult> {
  const client = getClickHouseClient();
  const added = await ResultAsync.fromPromise(
    client.command({ query: ddl.add }),
    (cause) => cause,
  );

  if (added.isErr()) {
    return {
      state: "failed",
      rollbackAttempted: false,
      rollbackSucceeded: null,
      message:
        added.error instanceof Error
          ? added.error.message
          : "The projection could not be added",
    };
  }

  const materialized = await ResultAsync.fromPromise(
    client.command({
      query: ddl.materialize,
      clickhouse_settings: {
        mutations_sync: "2",
      },
    }),
    (cause) => cause,
  );

  if (materialized.isOk()) {
    return {
      state: "applied",
      rollbackAttempted: false,
      rollbackSucceeded: null,
    };
  }

  const rollback = await ResultAsync.fromPromise(
    client.command({ query: ddl.rollback }),
    (cause) => cause,
  );

  return {
    state: rollback.isOk() ? "rolled_back" : "failed",
    rollbackAttempted: true,
    rollbackSucceeded: rollback.isOk(),
    message:
      materialized.error instanceof Error
        ? materialized.error.message
        : "The projection could not be materialized",
  };
}
