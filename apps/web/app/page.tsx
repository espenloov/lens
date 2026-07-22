import { randomUUID } from "node:crypto";

import { redirect } from "next/navigation";

import { PropertyChat } from "@/components/property-chat";
import { parsePropertyChatId } from "@/lib/chat/session";

type HomeProps = {
  readonly searchParams: Promise<{
    readonly chat?: string | string[];
  }>;
};

export default async function Home({ searchParams }: HomeProps) {
  const parameters = await searchParams;
  const chatId = parsePropertyChatId(parameters.chat);

  if (chatId === null) {
    redirect(`/?chat=${randomUUID()}`);
  }

  return (
    <main className="flex min-h-screen flex-col items-center px-6 py-16">
      <div className="mb-10 w-full max-w-2xl">
        <p className="mb-2 text-sm font-medium text-muted-foreground">
          Conversational property intelligence
        </p>

        <h1 className="text-4xl font-semibold tracking-tight">Lens</h1>

        <p className="mt-3 text-muted-foreground">
          Explore nearly 29 million UK property transactions.
        </p>
      </div>

      <PropertyChat chatId={chatId} key={chatId} />
    </main>
  );
}
