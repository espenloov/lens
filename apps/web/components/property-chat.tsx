"use client";

import { useState, type FormEvent } from "react";
import { useChat } from "@ai-sdk/react";
import {
  useTriggerChatTransport,
  type InferChatUIMessage,
} from "@trigger.dev/sdk/chat/react";
import { useRouter } from "next/navigation";

import {
  mintPropertyChatAccessToken,
  startPropertyChatSession,
} from "@/app/actions/chat";
import { MessagePart } from "@/components/chat/message-part";
import { Button } from "@/components/ui/button";
import type { propertyAgent } from "@/src/trigger/property-agent";

type PropertyChatMessage = InferChatUIMessage<typeof propertyAgent>;

type PropertyChatProps = {
  readonly chatId: string;
};

export function PropertyChat({ chatId }: PropertyChatProps) {
  const [input, setInput] = useState("");
  const router = useRouter();

  const transport = useTriggerChatTransport<typeof propertyAgent>({
    task: "property-agent",
    accessToken: ({ chatId }) => mintPropertyChatAccessToken(chatId),
    startSession: ({ chatId, clientData }) =>
      startPropertyChatSession({ chatId, clientData }),
  });

  const { messages, sendMessage, status, stop, error } =
    useChat<PropertyChatMessage>({
      id: chatId,
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

  function startNewAnalysis() {
    router.push(`/?chat=${crypto.randomUUID()}`);
  }

  return (
    <section className="flex w-full max-w-5xl flex-col gap-6">
      <div className="flex justify-end">
        <Button
          disabled={isBusy}
          onClick={startNewAnalysis}
          type="button"
          variant="outline"
        >
          New analysis
        </Button>
      </div>

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
                ? "max-w-2xl self-end"
                : "flex w-full flex-col items-start gap-4"
            }
          >
            {message.parts.map((part, index) => (
              <MessagePart
                key={`${message.id}-${index}`}
                part={part}
                role={message.role}
              />
            ))}
          </div>
        ))}

        {status === "submitted" && (
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
