import { z } from "zod";

export const propertyChatIdSchema = z.uuid();

export function parsePropertyChatId(value: unknown): string | null {
  const parsed = propertyChatIdSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
