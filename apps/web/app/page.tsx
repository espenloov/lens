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
    <main className="lens-canvas h-screen overflow-hidden p-3 sm:p-5 lg:p-7">
      <div className="lens-workspace relative mx-auto h-full max-w-[1480px] overflow-hidden">
        <PropertyChat chatId={chatId} key={chatId} />
      </div>
    </main>
  );
}
