import { z } from "zod";

const clickHouseEnvironmentSchema = z.object({
  CLICKHOUSE_HOST: z.url(),
  CLICKHOUSE_USER: z.string().min(1),
  CLICKHOUSE_PASSWORD: z.string().min(1),
  CLICKHOUSE_DATABASE: z.string().min(1),
});

export type ClickHouseConfig = {
  url: string;
  username: string;
  password: string;
  database: string;
};

export function getClickHouseConfig(): ClickHouseConfig {
  const environment = clickHouseEnvironmentSchema.parse(process.env);

  return {
    url: environment.CLICKHOUSE_HOST,
    username: environment.CLICKHOUSE_USER,
    password: environment.CLICKHOUSE_PASSWORD,
    database: environment.CLICKHOUSE_DATABASE,
  };
}
