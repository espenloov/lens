import postgres, { type Sql } from "postgres";

import { getPostgresUrl } from "./config";

let client: Sql | undefined;

export function getPostgresClient(): Sql | null {
  const url = getPostgresUrl();

  if (url === null) {
    return null;
  }

  client ??= postgres(url, {
    max: 5,
    idle_timeout: 20,
    connect_timeout: 10,
  });

  return client;
}
