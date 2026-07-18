import { err, ok, ResultAsync } from "neverthrow";

import { getClickHouseClient } from "./client";

export type ClickHouseHealthError = {
  readonly type: "clickhouse_health_error";
  readonly message: string;
  readonly cause: unknown;
};

function toClickHouseHealthError(cause: unknown): ClickHouseHealthError {
  return {
    type: "clickhouse_health_error",
    message:
      cause instanceof Error
        ? cause.message
        : "the clickhouse health check failed",
    cause,
  };
}

export function checkClickHouseConnection(): ResultAsync<
  void,
  ClickHouseHealthError
> {
  const ping = async () => {
    const client = getClickHouseClient();

    return client.ping({
      select: true,
    });
  };

  return ResultAsync.fromPromise(ping(), toClickHouseHealthError).andThen(
    (result) => {
      if (!result.success) {
        return err(toClickHouseHealthError(result.error));
      }

      return ok(undefined);
    },
  );
}
