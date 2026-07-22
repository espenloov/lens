import { z } from "zod";

const postgresEnvironmentSchema = z.object({
  DATABASE_URL: z.url().optional(),
});

export function getPostgresUrl(): string | null {
  return postgresEnvironmentSchema.parse(process.env).DATABASE_URL ?? null;
}
