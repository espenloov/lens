"use server";

import { auth } from "@trigger.dev/sdk";
import { chat } from "@trigger.dev/sdk/ai";

import { propertyChatIdSchema } from "@/lib/chat/session";

const startSession = chat.createStartSessionAction("property-agent");

export async function startPropertyChatSession(
  input: Parameters<typeof startSession>[0],
) {
  const chatId = propertyChatIdSchema.parse(input.chatId);
  return startSession({ ...input, chatId });
}

export async function mintPropertyChatAccessToken(chatId: string) {
  const validatedChatId = propertyChatIdSchema.parse(chatId);

  return auth.createPublicToken({
    scopes: {
      read: { sessions: validatedChatId },
      write: { sessions: validatedChatId },
    },
    expirationTime: "1h",
  });
}
