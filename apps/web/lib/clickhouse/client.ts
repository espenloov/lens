import { createClient, type ClickHouseClient } from "@clickhouse/client";

import { getClickHouseConfig } from "./config";

let client: ClickHouseClient | undefined;

export function getClickHouseClient(): ClickHouseClient {
  if (client) {
    return client;
  }

  const config = getClickHouseConfig();

  client = createClient({
    url: config.url,
    username: config.username,
    password: config.password,
    database: config.database,
    application: "lens",
  });

  return client;
}
