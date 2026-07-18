"use client";

import { useState, type FormEvent } from "react";
import { useChat } from "@ai-sdk/react";
import { useTriggerChatTransport } from "@trigger.dev/sdk/chat/react";

import {
  mintPropertyChatAccessToken,
  startPropertyChatSession,
} from "@/app/actions/chat";
import { Button } from "@/components/ui/button";
import type { propertyAgent } from "@/src/trigger/property-agent";

export function PropertyChat() {
  const [input, setInput] = useState("");

  const transport = useTriggerChatTransport<typeof propertyAgent>({
    task: "property-agent",
    accessToken: ({ chatId }) => mintPropertyChatAccessToken(chatId),
    startSession: ({ chatId, clientData }) =>
      startPropertyChatSession({ chatId, clientData }),
  });

  const { messages, sendMessage, status, stop, error } = useChat({
    transport,
  });

  const isBusy = status === "submitted" || status === "streaming";

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const question = input.trim();

    if (!question || isBusy) {
      return;
    }

    void sendMessage({ text: question });
    setInput("");
  }

  return (
    <section className="flex w-full max-w-2xl flex-col gap-6">
      <div className="flex min-h-80 flex-col gap-4 rounded-xl border p-6">
        {messages.length === 0 && (
          <p className="text-sm text-muted-foreground">
            Ask a question about the UK property market.
          </p>
        )}

        {messages.map((message) => (
          <div
            key={message.id}
            className={
              message.role === "user"
                ? "self-end rounded-xl bg-foreground px-4 py-3 text-background"
                : "self-start rounded-xl bg-muted px-4 py-3"
            }
          >
            {message.parts.map((part, index) => {
              if (part.type !== "text") {
                return null;
              }

              return <p key={index}>{part.text}</p>;
            })}
          </div>
        ))}

        {isBusy && (
          <p className="text-sm text-muted-foreground">Lens is thinking…</p>
        )}

        {error && (
          <p className="text-sm text-destructive">
            Lens could not complete that request.
          </p>
        )}
      </div>

      <form className="flex gap-3" onSubmit={handleSubmit}>
        <label className="sr-only" htmlFor="question">
          Property-market question
        </label>

        <input
          id="question"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder="How have prices changed in Manchester?"
          className="h-10 flex-1 rounded-md border bg-background px-3 outline-none focus:ring-2"
        />

        {isBusy ? (
          <Button type="button" variant="outline" onClick={() => void stop()}>
            Stop
          </Button>
        ) : (
          <Button type="submit">Ask</Button>
        )}
      </form>
    </section>
  );
}
