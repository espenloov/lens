"use server";

import { auth, runs, sessions } from "@trigger.dev/sdk";
import { chat } from "@trigger.dev/sdk/ai";
import { ResultAsync } from "neverthrow";

import { propertyChatIdSchema } from "@/lib/chat/session";
import type { TriggerRunDetails } from "@/lib/trigger/run-details";

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

function asIsoString(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  return value instanceof Date ? value.toISOString() : value;
}

export async function getPropertyChatRunDetails(
  chatId: string,
): Promise<TriggerRunDetails | null> {
  const validatedChatId = propertyChatIdSchema.parse(chatId);
  const session = await ResultAsync.fromPromise(
    sessions.retrieve(validatedChatId),
    (cause) => cause,
  );

  if (session.isErr()) {
    return null;
  }

  const currentRunId = session.value.currentRunId;

  if (typeof currentRunId !== "string") {
    return null;
  }

  const retrieved = await ResultAsync.fromPromise(
    runs.retrieve(currentRunId),
    (cause) => cause,
  );

  if (retrieved.isErr()) {
    return null;
  }

  const run = retrieved.value;

  return {
    runId: run.id,
    status: run.status,
    taskIdentifier: run.taskIdentifier,
    version: run.version === undefined ? null : String(run.version),
    createdAt: asIsoString(run.createdAt) ?? new Date().toISOString(),
    startedAt: asIsoString(run.startedAt),
    finishedAt: asIsoString(run.finishedAt),
    durationMs: run.durationMs,
    costInCents: run.costInCents ?? null,
    attemptCount: run.attemptCount,
    attempts: [
      {
        number: run.attemptCount,
        status: run.status,
        startedAt: asIsoString(run.startedAt),
        completedAt: asIsoString(run.finishedAt),
        errorMessage: run.error?.message ?? null,
      },
    ],
  };
}
