"use client";

import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { useChat } from "@ai-sdk/react";
import {
  useTriggerChatTransport,
  type InferChatUIMessage,
} from "@trigger.dev/sdk/chat/react";
import { useRouter } from "next/navigation";
import {
  Aperture,
  ArrowRight,
  ArrowUp,
  Database,
  Gauge,
  History,
  LayoutDashboard,
  Plus,
  Square,
} from "lucide-react";

import {
  mintPropertyChatAccessToken,
  startPropertyChatSession,
} from "@/app/actions/chat";
import { MessagePart } from "@/components/chat/message-part";
import { DashboardAssembly } from "@/components/dashboard-assembly";
import { Button } from "@/components/ui/button";
import type { propertyAgent } from "@/src/trigger/property-agent";

type PropertyChatMessage = InferChatUIMessage<typeof propertyAgent>;
type LensView = "workspace" | "clickhouse" | "performance" | "history";

type PropertyChatProps = {
  readonly chatId: string;
};

type RailActionProps = {
  readonly active?: boolean;
  readonly children: ReactNode;
  readonly label: string;
  readonly onClick: () => void;
};

const STARTER_QUESTIONS = [
  {
    label: "Compare places",
    question: "Compare Manchester and Liverpool prices since 2015",
    preview: "compare",
  },
  {
    label: "Find anomalies",
    question: "Find unusual monthly price changes by property type",
    preview: "anomaly",
  },
  {
    label: "Explore locally",
    question: "Explore every UK property sale in 2022",
    preview: "density",
  },
] as const;

const VIEW_TITLES: Record<LensView, string> = {
  workspace: "Analysis workspace",
  clickhouse: "ClickHouse data plane",
  performance: "Performance laboratory",
  history: "Analysis history",
};

function messageText(message: PropertyChatMessage): string {
  for (const part of message.parts) {
    if (part.type === "text") {
      return part.text;
    }
  }

  return "";
}

function RailAction({
  active = false,
  children,
  label,
  onClick,
}: RailActionProps) {
  return (
    <button
      aria-current={active ? "page" : undefined}
      aria-label={label}
      className="rail-action group relative"
      onClick={onClick}
      title={label}
      type="button"
    >
      {children}
      <span className="pointer-events-none absolute left-[3.5rem] z-50 whitespace-nowrap rounded-lg bg-[#09265b] px-2.5 py-1.5 text-xs font-medium text-white opacity-0 shadow-lg transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
        {label}
      </span>
    </button>
  );
}

function StarterPreview({ kind }: { readonly kind: (typeof STARTER_QUESTIONS)[number]["preview"] }) {
  if (kind === "compare") {
    return (
      <svg aria-hidden="true" className="h-14 w-full" viewBox="0 0 220 56">
        <path d="M4 42 C35 38 43 22 72 27 S116 40 140 18 S183 16 216 8" fill="none" stroke="var(--chart-1)" strokeWidth="3" />
        <path d="M4 49 C33 45 52 35 76 39 S121 25 145 31 S185 24 216 19" fill="none" stroke="var(--chart-2)" strokeWidth="3" />
      </svg>
    );
  }

  if (kind === "anomaly") {
    return (
      <svg aria-hidden="true" className="h-14 w-full" viewBox="0 0 220 56">
        <path d="M4 39 C35 30 48 34 72 29 S112 35 135 28 S177 34 216 22" fill="none" stroke="var(--chart-1)" strokeWidth="3" />
        <circle cx="135" cy="28" fill="var(--chart-3)" r="6" />
      </svg>
    );
  }

  return (
    <div aria-hidden="true" className="grid h-14 grid-cols-10 items-end gap-1">
      {[28, 42, 58, 78, 92, 70, 52, 86, 62, 34].map((height, index) => (
        <span
          className="rounded-sm bg-[#1769df]"
          key={index}
          style={{ height: `${height}%`, opacity: 0.2 + index * 0.07 }}
        />
      ))}
    </div>
  );
}

function ClickHouseView() {
  return (
    <div className="view-dashboard h-full overflow-hidden">
      <div className="analysis-bento">
        {[
          ["Table", "pp_complete"],
          ["Transactions", "28,919,900"],
          ["Coverage", "1995–2024"],
          ["Columns", "13 typed fields"],
        ].map(([label, value]) => (
          <section className="analysis-tile col-span-6 p-5 lg:col-span-3" key={label}>
            <p className="text-xs text-[#66758e]">{label}</p>
            <p className="mt-3 text-xl font-semibold tabular-nums text-[#09265b]">{value}</p>
          </section>
        ))}

        <section className="analysis-tile col-span-12 p-6 lg:col-span-7">
          <p className="text-xs font-medium text-[#9a7b00]">ClickHouse</p>
          <h2 className="mt-3 text-2xl font-semibold tracking-[-0.025em] text-[#09265b]">
            The analytical source of truth
          </h2>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-[#66758e]">
            The agent converts a validated analysis plan into bounded SQL. ClickHouse scans only the columns needed for the answer and streams the result as typed Arrow data.
          </p>
          <div className="mt-6 grid grid-cols-3 gap-3 text-xs text-[#596983]">
            {["Safe plan", "Columnar scan", "ArrowStream"].map((step, index) => (
              <div className="rounded-xl bg-[#f5c400]/10 px-3 py-4" key={step}>
                <span className="font-mono text-[#9a7b00]">0{index + 1}</span>
                <span className="mt-2 block font-medium text-[#09265b]">{step}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="analysis-tile col-span-12 p-6 lg:col-span-5">
          <p className="text-xs text-[#66758e]">Available dimensions</p>
          <div className="mt-4 flex flex-wrap gap-2">
            {["price", "date", "postcode", "type", "new build", "tenure", "street", "town", "district", "county"].map((column) => (
              <span className="rounded-lg border border-[#09265b]/8 bg-white/70 px-2.5 py-1.5 font-mono text-xs text-[#596983]" key={column}>
                {column}
              </span>
            ))}
          </div>
          <p className="mt-6 border-t border-[#09265b]/8 pt-5 text-xs leading-5 text-[#66758e]">
            Exact rows read, bytes scanned, query ID, and server timing are attached to each completed analysis.
          </p>
        </section>
      </div>
    </div>
  );
}

function PerformanceView() {
  const stages = [
    ["Trigger.dev", "Durable agent run", "var(--trigger)"],
    ["ClickHouse", "Parallel analytical scan", "var(--clickhouse)"],
    ["Arrow", "Typed columnar transfer", "var(--arrow)"],
    ["Rust / WASM", "Decode and local compute", "var(--rust)"],
  ] as const;

  return (
    <div className="view-dashboard h-full overflow-hidden">
      <div className="analysis-bento">
        <section className="analysis-tile col-span-12 p-6 lg:col-span-8">
          <p className="text-xs text-[#66758e]">Measured execution path</p>
          <h2 className="mt-3 text-2xl font-semibold tracking-[-0.025em] text-[#09265b]">
            Every answer leaves a performance trace
          </h2>
          <ol className="mt-7 grid grid-cols-2 gap-3 lg:grid-cols-4">
            {stages.map(([name, detail, color], index) => (
              <li className="rounded-2xl border border-[#09265b]/8 bg-white/62 p-4" key={name}>
                <span className="block h-1 w-8 rounded-full" style={{ background: color }} />
                <span className="mt-5 block font-mono text-xs text-[#8591a5]">0{index + 1}</span>
                <span className="mt-2 block text-sm font-semibold text-[#09265b]">{name}</span>
                <span className="mt-1 block text-xs leading-5 text-[#66758e]">{detail}</span>
              </li>
            ))}
          </ol>
        </section>

        <section className="analysis-tile col-span-12 p-6 lg:col-span-4">
          <p className="text-xs text-[#66758e]">Query Arena</p>
          <h3 className="mt-3 text-xl font-semibold text-[#09265b]">SQL strategies race safely</h3>
          <p className="mt-3 text-sm leading-6 text-[#66758e]">
            Trigger.dev runs candidate queries in parallel. Rust fingerprints the typed results, so a faster strategy wins only when it is equivalent.
          </p>
          <div className="mt-6 rounded-2xl bg-[#09265b] p-4 text-white">
            <p className="text-xs text-white/60">Safety rule</p>
            <p className="mt-2 text-sm font-medium">Fast + identical result → reusable recipe</p>
          </div>
        </section>

        <section className="analysis-tile col-span-12 grid gap-5 p-6 sm:grid-cols-3">
          {[
            ["Server", "ClickHouse elapsed time"],
            ["Transport", "Arrow bytes and round trip"],
            ["Browser", "WASM startup and Rust compute"],
          ].map(([label, detail]) => (
            <div key={label}>
              <p className="text-sm font-semibold text-[#09265b]">{label}</p>
              <p className="mt-1 text-xs text-[#66758e]">{detail}</p>
              <div className="mt-4 h-1.5 rounded-full bg-[#e6edf5]">
                <div className="h-full w-1/3 rounded-full bg-[#21c5be]" />
              </div>
            </div>
          ))}
        </section>
      </div>
    </div>
  );
}

function HistoryView({
  questions,
  onAskAgain,
}: {
  readonly questions: readonly string[];
  readonly onAskAgain: (question: string) => void;
}) {
  return (
    <div className="view-dashboard h-full overflow-hidden">
      <div className="analysis-bento h-full">
        <section className="analysis-tile col-span-12 min-h-0 overflow-hidden p-6 lg:col-span-5">
          <p className="text-xs text-[#66758e]">This session</p>
          <h2 className="mt-3 text-2xl font-semibold tracking-[-0.025em] text-[#09265b]">
            {questions.length === 0 ? "No analyses yet" : `${questions.length} ${questions.length === 1 ? "analysis" : "analyses"}`}
          </h2>
          <div className="soft-scrollbar mt-6 max-h-[24rem] divide-y divide-[#09265b]/8 overflow-y-auto">
            {questions.map((question, index) => (
              <button
                className="group flex w-full items-center justify-between gap-4 py-4 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1769df]"
                key={`${question}-${index}`}
                onClick={() => onAskAgain(question)}
                type="button"
              >
                <span>
                  <span className="block text-xs text-[#8591a5]">Analysis {String(index + 1).padStart(2, "0")}</span>
                  <span className="mt-1 line-clamp-2 block text-sm font-medium leading-5 text-[#09265b]">{question}</span>
                </span>
                <ArrowRight className="size-4 shrink-0 text-[#21a8a3] transition-transform group-hover:translate-x-1" />
              </button>
            ))}
          </div>
        </section>

        <section className="analysis-tile col-span-12 flex flex-col justify-between p-7 lg:col-span-7">
          <div>
            <p className="text-xs text-[#66758e]">Session memory</p>
            <h3 className="mt-4 max-w-xl text-3xl font-semibold leading-tight tracking-[-0.03em] text-[#09265b]">
              Reuse a question without rebuilding the interface around a transcript.
            </h3>
            <p className="mt-4 max-w-lg text-sm leading-6 text-[#66758e]">
              Lens keeps the active analytical workspace mounted. That preserves the browser-side Rust index while you inspect ClickHouse or performance evidence.
            </p>
          </div>
          <p className="mt-8 border-t border-[#09265b]/8 pt-5 text-xs text-[#66758e]">
            Selecting an item places its question back in the composer so you can refine or run it again.
          </p>
        </section>
      </div>
    </div>
  );
}

export function PropertyChat({ chatId }: PropertyChatProps) {
  const [input, setInput] = useState("");
  const [activeView, setActiveView] = useState<LensView>("workspace");
  const [settling, setSettling] = useState(false);
  const wasBusy = useRef(false);
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

  useEffect(() => {
    void transport.preload(chatId);
  }, [chatId, transport]);

  const isBusy = status === "submitted" || status === "streaming";

  useEffect(() => {
    if (isBusy) {
      wasBusy.current = true;
      return;
    }

    if (!wasBusy.current) {
      return;
    }

    wasBusy.current = false;
    const start = window.setTimeout(() => setSettling(true), 0);
    const finish = window.setTimeout(() => setSettling(false), 650);

    return () => {
      window.clearTimeout(start);
      window.clearTimeout(finish);
    };
  }, [isBusy]);

  const sessionQuestions = messages
    .filter((message) => message.role === "user")
    .map(messageText)
    .filter((question) => question.length > 0);
  let latestUserIndex = -1;

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === "user") {
      latestUserIndex = index;
      break;
    }
  }

  const latestUserMessage = latestUserIndex < 0 ? null : messages[latestUserIndex];
  const assistantMessages = messages.slice(latestUserIndex + 1);
  let latestToolPart: PropertyChatMessage["parts"][number] | null = null;
  let latestAssistantTextPart: PropertyChatMessage["parts"][number] | null = null;

  for (const message of assistantMessages) {
    if (message.role !== "assistant") {
      continue;
    }

    for (const part of message.parts) {
      if (part.type === "tool-submitAnalysisPlan") {
        latestToolPart = part;
      } else if (part.type === "text" && part.text.length > 0) {
        latestAssistantTextPart = part;
      }
    }
  }

  const hasAnalysisResult = latestToolPart !== null && !isBusy;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    submitQuestion(input);
  }

  function submitQuestion(value: string) {
    const question = value.trim();

    if (!question || isBusy) {
      return;
    }

    setActiveView("workspace");
    setSettling(false);
    void sendMessage({ text: question });
    setInput("");
  }

  function startNewAnalysis() {
    router.push(`/?chat=${crypto.randomUUID()}`);
  }

  function askAgain(question: string) {
    setInput(question);
    setActiveView("workspace");
  }

  return (
    <section className="grid h-full min-h-0 grid-cols-1 sm:grid-cols-[76px_minmax(0,1fr)]">
      <nav aria-label="Lens views" className="lens-rail hidden min-h-0 flex-col items-center px-3 py-5 sm:flex">
        <div aria-label="Lens" className="grid size-11 place-items-center rounded-2xl bg-[#09265b] text-white">
          <Aperture aria-hidden="true" className="size-5" />
        </div>

        <div className="mt-8 flex flex-col items-center gap-2">
          <RailAction label="New analysis" onClick={startNewAnalysis}>
            <Plus aria-hidden="true" className="size-5" />
          </RailAction>
          <RailAction active={activeView === "workspace"} label="Workspace" onClick={() => setActiveView("workspace")}>
            <LayoutDashboard aria-hidden="true" className="size-5" />
          </RailAction>
          <RailAction active={activeView === "clickhouse"} label="ClickHouse" onClick={() => setActiveView("clickhouse")}>
            <Database aria-hidden="true" className="size-5" />
          </RailAction>
          <RailAction active={activeView === "performance"} label="Performance" onClick={() => setActiveView("performance")}>
            <Gauge aria-hidden="true" className="size-5" />
          </RailAction>
          <RailAction active={activeView === "history"} label="History" onClick={() => setActiveView("history")}>
            <History aria-hidden="true" className="size-5" />
          </RailAction>
        </div>

        <div className="mt-auto flex items-center gap-2" title="Application ready">
          <span className="size-2 rounded-full bg-[#21c5be]" />
          <span className="sr-only">Application ready</span>
        </div>
      </nav>

      <div className="grid min-h-0 min-w-0 grid-rows-[60px_minmax(0,1fr)_82px] sm:grid-rows-[64px_minmax(0,1fr)_82px]">
        <header className="flex items-center justify-between border-b border-[#09265b]/8 px-5 sm:px-7">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-[#09265b]">{VIEW_TITLES[activeView]}</p>
            <p className="mt-0.5 text-xs text-[#66758e]">Lens · property intelligence</p>
          </div>
          <div className="flex items-center gap-2 rounded-xl border border-[#09265b]/8 bg-white/58 px-3 py-2 text-xs text-[#596983]">
            <span className="size-2 rounded-full bg-[#f5c400]" />
            <span className="hidden sm:inline">UK Price Paid · 28.9m rows</span>
            <span className="sm:hidden">28.9m rows</span>
          </div>
        </header>

        <main className="relative min-h-0 min-w-0 overflow-hidden px-4 py-4 sm:px-6 sm:py-5">
          <section aria-hidden={activeView !== "workspace"} className="h-full min-h-0" hidden={activeView !== "workspace"}>
            {messages.length === 0 ? (
              <div className="flex h-full min-h-0 flex-col justify-center">
                <div className="mx-auto w-full max-w-5xl">
                  <p className="text-sm font-medium text-[#176f6b]">Ask the market</p>
                  <h1 className="mt-4 max-w-3xl text-balance text-4xl font-semibold leading-[1.02] tracking-[-0.045em] text-[#09265b] sm:text-5xl lg:text-[3.55rem]">
                    Turn 29 million property sales into a clear answer.
                  </h1>
                  <p className="mt-4 max-w-xl text-sm leading-6 text-[#66758e]">
                    Ask a normal question. Lens builds the analytical dashboard, then lets Rust reshape the result locally.
                  </p>

                  <div className="mt-8 grid gap-3 lg:grid-cols-3">
                    {STARTER_QUESTIONS.map((starter) => (
                      <button
                        className="analysis-tile group min-h-44 p-5 text-left transition-transform duration-200 hover:-translate-y-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1769df] motion-reduce:transition-none"
                        key={starter.question}
                        onClick={() => submitQuestion(starter.question)}
                        type="button"
                      >
                        <StarterPreview kind={starter.preview} />
                        <span className="mt-5 flex items-center justify-between gap-4">
                          <span>
                            <span className="block text-sm font-semibold text-[#09265b]">{starter.label}</span>
                            <span className="mt-1 line-clamp-2 block text-xs leading-5 text-[#66758e]">{starter.question}</span>
                          </span>
                          <ArrowRight aria-hidden="true" className="size-4 shrink-0 text-[#21a8a3] transition-transform group-hover:translate-x-1" />
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex h-full min-h-0 flex-col gap-3">
                {latestUserMessage !== null && (
                  <div className="max-w-4xl shrink-0">
                    {latestUserMessage.parts.map((part, index) => (
                      <MessagePart key={`${latestUserMessage.id}-${index}`} part={part} role="user" />
                    ))}
                  </div>
                )}

                <div className="relative min-h-0 flex-1">
                  {hasAnalysisResult && latestToolPart !== null && (
                    <div
                      className={`workspace-result soft-scrollbar h-full min-h-0 overflow-y-auto pr-1 ${
                        settling ? "dashboard-revealing" : ""
                      }`}
                    >
                      <MessagePart part={latestToolPart} role="assistant" />
                    </div>
                  )}

                  {!isBusy && latestToolPart === null && latestAssistantTextPart !== null && (
                    <MessagePart part={latestAssistantTextPart} role="assistant" />
                  )}

                  {(isBusy || settling) && (
                    <div className="absolute inset-0 z-20">
                      <DashboardAssembly settling={settling} />
                    </div>
                  )}

                  {error && (
                    <p className="glass-panel relative z-30 rounded-2xl p-4 text-sm text-destructive">
                      Lens could not complete that request.
                    </p>
                  )}
                </div>
              </div>
            )}
          </section>

          <section aria-hidden={activeView !== "clickhouse"} className="h-full min-h-0" hidden={activeView !== "clickhouse"}>
            <ClickHouseView />
          </section>
          <section aria-hidden={activeView !== "performance"} className="h-full min-h-0" hidden={activeView !== "performance"}>
            <PerformanceView />
          </section>
          <section aria-hidden={activeView !== "history"} className="h-full min-h-0" hidden={activeView !== "history"}>
            <HistoryView onAskAgain={askAgain} questions={sessionQuestions} />
          </section>
        </main>

        <form
          className="mx-4 mb-4 flex min-w-0 items-center gap-3 rounded-2xl border border-white/90 bg-white/76 p-2 pl-4 shadow-[0_14px_36px_rgb(46_75_116_/_10%)] backdrop-blur-2xl transition-shadow focus-within:ring-2 focus-within:ring-[#1769df]/70 sm:mx-6"
          onSubmit={handleSubmit}
        >
          <label className="sr-only" htmlFor="question">Property-market question</label>
          <Plus aria-hidden="true" className="size-4 shrink-0 text-[#8591a5]" />
          <input
            className="h-11 min-w-0 flex-1 border-0 bg-transparent text-sm text-[#24375b] outline-none placeholder:text-[#8591a5]"
            id="question"
            onChange={(event) => setInput(event.target.value)}
            placeholder="Ask about prices, places, patterns or anomalies…"
            value={input}
          />
          {isBusy ? (
            <Button aria-label="Stop analysis" className="size-11 shrink-0 rounded-xl" onClick={() => void stop()} type="button" variant="outline">
              <Square aria-hidden="true" className="size-3.5 fill-current" />
            </Button>
          ) : (
            <Button aria-label="Ask Lens" className="size-11 shrink-0 rounded-xl bg-[#09265b] text-white shadow-none hover:bg-[#123a78]" type="submit">
              <ArrowUp aria-hidden="true" className="size-4" />
            </Button>
          )}
        </form>
      </div>
    </section>
  );
}
