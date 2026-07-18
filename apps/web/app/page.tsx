import { PropertyChat } from "@/components/property-chat";

export default function Home() {
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

      <PropertyChat />
    </main>
  );
}
