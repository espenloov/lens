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
  ArrowRight,
  ArrowUp,
  Database,
  Gauge,
  History,
  House,
  LayoutDashboard,
  Plus,
  Square,
} from "lucide-react";

import {
  mintPropertyChatAccessToken,
  startPropertyChatSession,
} from "@/app/actions/chat";
import {
  AnalysisPerformanceProvider,
  useAnalysisPerformance,
} from "@/components/analysis/performance-context";
import {
  AnalysisNavigationProvider,
  type PerformanceFocus,
} from "@/components/analysis/analysis-navigation";
import { PerformanceView } from "@/components/analysis/performance-view";
import { BrandMark } from "@/components/brand-mark";
import { MessagePart } from "@/components/chat/message-part";
import { DashboardAssembly } from "@/components/dashboard-assembly";
import { TechnologyMark } from "@/components/technology-mark";
import { Button } from "@/components/ui/button";
import type {
  DataSourceProfile,
  DataSourceSummary,
} from "@/lib/data-sources/contracts";
import type { propertyAgent } from "@/src/trigger/property-agent";

type PropertyChatMessage = InferChatUIMessage<typeof propertyAgent>;
type LensView = "workspace" | "clickhouse" | "performance" | "history";

type PropertyChatProps = {
  readonly chatId: string;
  readonly initialDataSource: DataSourceSummary;
  readonly initialDataSourceProfile: DataSourceProfile;
};

type RailActionProps = {
  readonly active?: boolean;
  readonly children: ReactNode;
  readonly label: string;
  readonly onClick: () => void;
};

const STARTER_QUESTIONS = [
  {
    label: "Understand the data",
    question: "Show me what this data looks like",
    preview: "density",
  },
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
] as const;

const GENERIC_STARTER_QUESTIONS = [
  {
    label: "Understand the data",
    question: "Show me what this data looks like",
    preview: "density",
    capability: "trend",
  },
  {
    label: "Show the trend",
    question: "Show the main measure over time",
    preview: "compare",
    capability: "trend",
  },
  {
    label: "Compare groups",
    question: "Compare the main measure across the leading groups",
    preview: "density",
    capability: "comparison",
  },
  {
    label: "Find anomalies",
    question: "Find unusual changes in the main measure",
    preview: "anomaly",
    capability: "anomaly",
  },
  {
    label: "See the distribution",
    question: "Show how the main measure is distributed",
    preview: "density",
    capability: "distribution",
  },
] as const;

const VIEW_TITLES: Record<LensView, string> = {
  workspace: "Analysis workspace",
  clickhouse: "Data overview",
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
      <span className="pointer-events-none absolute left-[3.5rem] z-[100] whitespace-nowrap rounded-lg bg-[var(--lens-dark)] px-2.5 py-1.5 text-xs font-medium text-white opacity-0 shadow-lg transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
        {label}
      </span>
    </button>
  );
}

function StarterPreview({
  kind,
}: {
  readonly kind: (typeof STARTER_QUESTIONS)[number]["preview"];
}) {
  if (kind === "compare") {
    return (
      <svg aria-hidden="true" className="h-14 w-full" viewBox="0 0 220 56">
        <path
          d="M4 42 C35 38 43 22 72 27 S116 40 140 18 S183 16 216 8"
          fill="none"
          stroke="var(--chart-1)"
          strokeWidth="3"
        />
        <path
          d="M4 49 C33 45 52 35 76 39 S121 25 145 31 S185 24 216 19"
          fill="none"
          stroke="var(--chart-2)"
          strokeWidth="3"
        />
      </svg>
    );
  }

  if (kind === "anomaly") {
    return (
      <svg aria-hidden="true" className="h-14 w-full" viewBox="0 0 220 56">
        <path
          d="M4 39 C35 30 48 34 72 29 S112 35 135 28 S177 34 216 22"
          fill="none"
          stroke="var(--chart-1)"
          strokeWidth="3"
        />
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

function formatPerformanceDuration(value: number): string {
  if (value < 1) {
    return `${value.toFixed(2)} ms`;
  }

  if (value < 1_000) {
    return `${value.toFixed(0)} ms`;
  }

  return `${(value / 1_000).toFixed(1)} s`;
}

function ClickHouseView({
  onAskOverview,
  profile,
  source,
}: {
  readonly onAskOverview: () => void;
  readonly profile: DataSourceProfile;
  readonly source: DataSourceSummary | null;
}) {
  const { latest, reports } = useAnalysisPerformance();
  const table = source?.table ?? "pp_complete";
  const rows = source?.rowCount ?? 28_919_900;
  const dateFrom = source?.dateFrom ?? "1995-01-01";
  const dateTo = source?.dateTo ?? "2024-01-31";
  const fields = [
    ...(profile.time === null
      ? []
      : [
          {
            key: profile.time.key,
            label: profile.time.label,
            role: "Time",
          },
        ]),
    ...profile.measures.map((measure) => ({
      key: measure.key,
      label: measure.label,
      role: "Measure",
    })),
    ...profile.dimensions.map((dimension) => ({
      key: dimension.key,
      label: dimension.label,
      role: "Group",
    })),
  ];
  const analysisModes = Object.values(
    source?.capabilities.operations ?? {},
  ).filter(Boolean).length;

  return (
    <div className="view-dashboard h-full overflow-hidden">
      <div className="analysis-bento h-full">
        <section className="brand-hero analysis-tile relative col-span-12 min-h-0 overflow-hidden p-7 lg:col-span-7 lg:row-span-2">
          <div className="relative z-10 flex h-full flex-col justify-between">
            <div>
              <div className="flex items-center gap-3">
                <TechnologyMark technology="clickhouse" />
                <div>
                  <p className="text-[11px] font-semibold text-[#8d7600]">
                    Selected ClickHouse table
                  </p>
                  <p className="mt-0.5 font-mono text-[10px] text-[var(--ink-tertiary)]">
                    {source?.database ?? "default"}.{table}
                  </p>
                </div>
              </div>
              <h2 className="mt-6 max-w-lg text-3xl font-semibold tracking-[-0.045em] text-[var(--ink)]">
                {source?.displayName ?? "UK Price Paid"}
              </h2>
              <p className="mt-3 max-w-md text-sm leading-6 text-[var(--ink-secondary)]">
                A validated analytical view with {fields.length} mapped fields
                and {analysisModes} ways to explore it.
              </p>
            </div>
            <div className="mt-7">
              <p className="font-mono text-[clamp(2.7rem,6vw,5.4rem)] font-medium leading-none tracking-[-0.07em] text-[var(--ink)]">
                {rows.toLocaleString()}
              </p>
              <div className="mt-4 flex items-center gap-3 text-xs text-[var(--ink-tertiary)]">
                <span>rows</span>
                <span>·</span>
                <span>
                  {dateFrom.slice(0, 4)}–{dateTo.slice(0, 4)}
                </span>
              </div>
              <button
                className="mt-6 inline-flex items-center gap-2 rounded-xl bg-[var(--lens-dark)] px-4 py-2.5 text-xs font-semibold text-white transition-transform hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#697cc7]"
                onClick={onAskOverview}
                type="button"
              >
                Show me this data
                <ArrowRight aria-hidden="true" className="size-3.5" />
              </button>
            </div>
          </div>
        </section>

        <section className="analysis-tile col-span-12 min-h-0 overflow-hidden p-6 lg:col-span-5">
          <div className="flex items-end justify-between gap-4">
            <div>
              <p className="text-[11px] text-[var(--ink-tertiary)]">
                What Lens understands
              </p>
              <h3 className="mt-2 text-xl font-semibold tracking-[-0.03em] text-[var(--ink)]">
                Mapped fields
              </h3>
            </div>
            <span className="font-mono text-[10px] text-[var(--ink-tertiary)]">
              {fields.length} fields
            </span>
          </div>
          <div className="soft-scrollbar mt-5 grid max-h-[12rem] grid-cols-2 gap-2 overflow-y-auto pr-1">
            {fields.map((field) => (
              <div
                className="analysis-tile-quiet min-w-0 px-3 py-2.5"
                key={`${field.role}:${field.key}`}
              >
                <p className="truncate text-xs font-semibold text-[var(--ink)]">
                  {field.label}
                </p>
                <p className="mt-1 text-[9px] font-medium uppercase tracking-[0.08em] text-[var(--ink-tertiary)]">
                  {field.role}
                </p>
              </div>
            ))}
          </div>
        </section>

        <section className="analysis-tile col-span-12 flex min-h-0 flex-col overflow-hidden p-6 lg:col-span-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[11px] text-[var(--ink-tertiary)]">
                Recent questions
              </p>
              <h3 className="mt-2 text-lg font-semibold tracking-[-0.03em] text-[var(--ink)]">
                Live analysis
              </h3>
            </div>
            <span className="rounded-full bg-[#21c5be]/10 px-2.5 py-1 text-[10px] font-semibold text-[#176f6b]">
              {reports.length} complete
            </span>
          </div>
          {reports.length === 0 ? (
            <div className="mt-4 flex flex-1 items-center justify-center gap-3 rounded-2xl border border-dashed border-[var(--line-strong)] text-center">
              <div className="flex items-center gap-2">
                <TechnologyMark technology="trigger" />
                <ArrowRight
                  aria-hidden="true"
                  className="size-4 text-[var(--ink-tertiary)]"
                />
                <TechnologyMark technology="clickhouse" />
              </div>
              <p className="text-xs font-semibold text-[var(--ink)]">
                Ready for a question
              </p>
            </div>
          ) : (
            <div className="soft-scrollbar mt-4 min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
              {reports.slice(0, 2).map((report, index) => (
                <div
                  className="analysis-tile-quiet grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 p-3"
                  key={report.id}
                >
                  <span className="grid size-8 place-items-center rounded-xl bg-[#885cf6]/10 font-mono text-[10px] text-[#6d46d8]">
                    {String(reports.length - index).padStart(2, "0")}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-xs font-semibold text-[var(--ink)]">
                      {report.question}
                    </p>
                    <p className="mt-1 truncate font-mono text-[9px] text-[var(--ink-tertiary)]">
                      {report.queryId ?? report.contract}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-mono text-[10px] text-[var(--ink)]">
                      {formatPerformanceDuration(report.roundTripMs)}
                    </p>
                    <p className="mt-1 text-[9px] text-[var(--ink-tertiary)]">
                      query
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="analysis-tile col-span-12 grid items-center gap-3 p-4 sm:grid-cols-3 lg:col-span-7">
          {[
            {
              detail:
                latest === null
                  ? "Durable agent"
                  : formatPerformanceDuration(latest.triggerMs),
              label: "Orchestrate",
              technology: "trigger" as const,
            },
            {
              detail:
                latest === null
                  ? `${analysisModes} analysis modes`
                  : formatPerformanceDuration(latest.roundTripMs),
              label: "Analyze",
              technology: "clickhouse" as const,
            },
            {
              detail:
                latest === null
                  ? "Winning recipes"
                  : `${reports.length} recorded`,
              label: "Remember",
              technology: "postgres" as const,
            },
          ].map((step, index) => (
            <div className="flex items-center gap-3 px-3" key={step.label}>
              <TechnologyMark technology={step.technology} />
              <div>
                <p className="text-xs font-semibold text-[var(--ink)]">
                  {step.label}
                </p>
                <p className="mt-1 font-mono text-[9px] text-[var(--ink-tertiary)]">
                  {step.detail}
                </p>
              </div>
              {index < 2 && (
                <ArrowRight
                  aria-hidden="true"
                  className="ml-auto hidden size-4 text-[var(--ink-tertiary)] sm:block"
                />
              )}
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
            {questions.length === 0
              ? "No analyses yet"
              : `${questions.length} ${questions.length === 1 ? "analysis" : "analyses"}`}
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
                  <span className="block text-xs text-[#8591a5]">
                    Analysis {String(index + 1).padStart(2, "0")}
                  </span>
                  <span className="mt-1 line-clamp-2 block text-sm font-medium leading-5 text-[#09265b]">
                    {question}
                  </span>
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
              Reuse a question without rebuilding the interface around a
              transcript.
            </h3>
            <p className="mt-4 max-w-lg text-sm leading-6 text-[#66758e]">
              Lens keeps the active analytical workspace mounted. That preserves
              the browser-side Rust index while you inspect ClickHouse or
              performance evidence.
            </p>
          </div>
          <p className="mt-8 border-t border-[#09265b]/8 pt-5 text-xs text-[#66758e]">
            Selecting an item places its question back in the composer so you
            can refine or run it again.
          </p>
        </section>
      </div>
    </div>
  );
}

function PropertyChatWorkspace({
  chatId,
  initialDataSource,
  initialDataSourceProfile,
}: PropertyChatProps) {
  const { beginAnalysis, failAnalysis, markPlanReady } =
    useAnalysisPerformance();
  const [input, setInput] = useState("");
  const [activeView, setActiveView] = useState<LensView>("workspace");
  const [performanceFocus, setPerformanceFocus] =
    useState<PerformanceFocus>("flow");
  const [askingAnother, setAskingAnother] = useState(false);
  const [settling, setSettling] = useState(false);
  const wasBusy = useRef(false);
  const router = useRouter();
  const activeSource = initialDataSource;
  const starterQuestions = activeSource.builtin
    ? STARTER_QUESTIONS
    : GENERIC_STARTER_QUESTIONS.filter(
        ({ capability }) => activeSource.capabilities.operations[capability],
      ).slice(0, 3);

  const transport = useTriggerChatTransport<typeof propertyAgent>({
    task: "property-agent",
    accessToken: ({ chatId }) => mintPropertyChatAccessToken(chatId),
    startSession: ({ chatId, clientData }) =>
      startPropertyChatSession({ chatId, clientData }),
    clientData: {
      dataset: activeSource.slug,
      datasetVersion: activeSource.version,
    },
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

  const latestUserMessage =
    latestUserIndex < 0 ? null : messages[latestUserIndex];
  const assistantMessages = messages.slice(latestUserIndex + 1);
  let latestToolPart: PropertyChatMessage["parts"][number] | null = null;
  let latestAssistantTextPart: PropertyChatMessage["parts"][number] | null =
    null;

  for (const message of assistantMessages) {
    if (message.role !== "assistant") {
      continue;
    }

    for (const part of message.parts) {
      if (
        part.type === "tool-submitAnalysisPlan" ||
        part.type === "tool-submitSemanticAnalysisPlan"
      ) {
        latestToolPart = part;
      } else if (part.type === "text" && part.text.length > 0) {
        latestAssistantTextPart = part;
      }
    }
  }

  const hasAnalysisResult = latestToolPart !== null && !isBusy;
  const showComposer = !hasAnalysisResult || askingAnother;

  useEffect(() => {
    if (hasAnalysisResult) {
      markPlanReady();
    }
  }, [hasAnalysisResult, markPlanReady]);

  useEffect(() => {
    if (error !== undefined) {
      failAnalysis(
        "agent",
        error.message || "The agent could not complete this question.",
      );
    }
  }, [error, failAnalysis]);

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
    setAskingAnother(false);
    setSettling(false);
    beginAnalysis(question, activeSource.slug, activeSource.version);
    void sendMessage({ text: question });
    setInput("");
  }

  function chooseDataSource() {
    router.push("/");
  }

  function askAnother() {
    setActiveView("workspace");
    setAskingAnother(true);
    window.setTimeout(
      () => document.querySelector<HTMLInputElement>("#question")?.focus(),
      0,
    );
  }

  function askAgain(question: string) {
    setInput(question);
    setActiveView("workspace");
  }

  function openPerformance(focus: PerformanceFocus = "flow") {
    setPerformanceFocus(focus);
    setActiveView("performance");
  }

  return (
    <AnalysisNavigationProvider openPerformance={openPerformance}>
      <section className="grid h-full min-h-0 grid-cols-1 sm:grid-cols-[76px_minmax(0,1fr)]">
        <nav
          aria-label="Lens views"
          className="lens-rail relative z-50 hidden min-h-0 flex-col items-center overflow-visible px-3 py-5 sm:flex"
        >
          <BrandMark
            className="drop-shadow-[0_10px_16px_rgb(45_57_84_/_18%)]"
            size={48}
          />

          <div className="mt-8 flex flex-col items-center gap-2">
            <RailAction label="Data source home" onClick={chooseDataSource}>
              <House aria-hidden="true" className="size-5" />
            </RailAction>
            <RailAction
              active={activeView === "workspace"}
              label="Workspace"
              onClick={() => setActiveView("workspace")}
            >
              <LayoutDashboard aria-hidden="true" className="size-5" />
            </RailAction>
            <RailAction
              active={activeView === "clickhouse"}
              label="Data overview"
              onClick={() => setActiveView("clickhouse")}
            >
              <Database aria-hidden="true" className="size-5" />
            </RailAction>
            <RailAction
              active={activeView === "performance"}
              label="Performance"
              onClick={() => openPerformance("flow")}
            >
              <Gauge aria-hidden="true" className="size-5" />
            </RailAction>
            <RailAction
              active={activeView === "history"}
              label="History"
              onClick={() => setActiveView("history")}
            >
              <History aria-hidden="true" className="size-5" />
            </RailAction>
          </div>

          <div
            className="mt-auto flex items-center gap-2"
            title="Application ready"
          >
            <span className="size-2 rounded-full bg-[#21c5be]" />
            <span className="sr-only">Application ready</span>
          </div>
        </nav>

        <div
          className={`grid min-h-0 min-w-0 ${
            showComposer
              ? "grid-rows-[64px_minmax(0,1fr)_82px]"
              : "grid-rows-[64px_minmax(0,1fr)]"
          }`}
        >
          <header className="flex items-center justify-between border-b border-[var(--line)] px-5 sm:px-7">
            <div className="flex min-w-0 items-center gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold tracking-[-0.025em] text-[var(--ink)]">
                  {VIEW_TITLES[activeView]}
                </p>
                <p className="mt-0.5 truncate text-[11px] text-[var(--ink-tertiary)]">
                  {activeSource.displayName} ·{" "}
                  {activeSource.rowCount.toLocaleString()} rows
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {hasAnalysisResult && (
                <button
                  className="flex items-center gap-2 rounded-xl border border-[var(--line)] bg-white/60 px-3 py-2 text-xs font-semibold text-[var(--ink)] shadow-sm transition-colors hover:bg-white"
                  onClick={askAnother}
                  type="button"
                >
                  <Plus
                    aria-hidden="true"
                    className="size-3.5 text-[#697cc7]"
                  />
                  <span className="hidden sm:inline">New question</span>
                  <span className="sr-only sm:hidden">New question</span>
                </button>
              )}
              <div className="flex items-center gap-2 rounded-xl border border-[var(--line)] bg-white/48 px-3 py-2 text-xs text-[var(--ink-secondary)]">
                <span className="size-2 rounded-full bg-[#f5c400]" />
                <span className="hidden sm:inline">ClickHouse live</span>
                <span className="sm:hidden">
                  {activeSource.rowCount.toLocaleString()}
                </span>
              </div>
            </div>
          </header>

          <main className="relative min-h-0 min-w-0 overflow-hidden px-4 py-4 sm:px-6 sm:py-5">
            <section
              aria-hidden={activeView !== "workspace"}
              className="h-full min-h-0"
              hidden={activeView !== "workspace"}
            >
              {messages.length === 0 ? (
                <div className="mx-auto grid h-full min-h-0 w-full max-w-6xl grid-cols-12 gap-3">
                  <section className="brand-hero analysis-tile relative col-span-12 flex min-h-0 flex-col justify-between overflow-hidden p-7 lg:col-span-7 lg:p-9">
                    <div className="relative z-10">
                      <p className="text-xs font-semibold tracking-[0.08em] text-[var(--ink-tertiary)]">
                        {activeSource.displayName}
                      </p>
                      <h1 className="mt-5 max-w-2xl text-balance text-4xl font-semibold leading-[1.02] tracking-[-0.055em] text-[var(--ink)] sm:text-5xl lg:text-[3.5rem]">
                        What do you want to see?
                      </h1>
                      <p className="mt-5 max-w-md text-sm leading-6 text-[var(--ink-secondary)]">
                        Ask naturally. Lens turns{" "}
                        {activeSource.rowCount.toLocaleString()} rows into a
                        visual answer you can explore.
                      </p>
                    </div>
                    <div className="relative z-10 mt-8 flex items-end justify-between gap-6">
                      <div>
                        <div className="optical-rule h-0.5 w-20 rounded-full" />
                      </div>
                      <BrandMark
                        className="drop-shadow-[0_24px_34px_rgb(45_57_84_/_20%)]"
                        size={142}
                      />
                    </div>
                  </section>

                  <div className="col-span-12 grid min-h-0 gap-3 lg:col-span-5 lg:grid-rows-3">
                    {starterQuestions.map((starter, index) => (
                      <button
                        className={`analysis-tile group grid min-h-32 grid-cols-[minmax(0,1fr)_9rem] items-center gap-4 overflow-hidden p-5 text-left transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-[0_24px_50px_rgb(45_57_84_/_11%)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#697cc7] motion-reduce:transition-none ${
                          index === 0 ? "bg-white/94" : ""
                        }`}
                        key={starter.question}
                        onClick={() => submitQuestion(starter.question)}
                        type="button"
                      >
                        <span className="min-w-0">
                          <span className="block text-sm font-semibold tracking-[-0.025em] text-[var(--ink)]">
                            {starter.label}
                          </span>
                          <span className="mt-2 line-clamp-2 block text-xs leading-5 text-[var(--ink-tertiary)]">
                            {starter.question}
                          </span>
                          <ArrowRight
                            aria-hidden="true"
                            className="mt-4 size-4 text-[#697cc7] transition-transform group-hover:translate-x-1"
                          />
                        </span>
                        <StarterPreview kind={starter.preview} />
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="flex h-full min-h-0 flex-col gap-3">
                  {latestUserMessage !== null && (
                    <div className="max-w-4xl shrink-0">
                      {latestUserMessage.parts.map((part, index) => (
                        <MessagePart
                          key={`${latestUserMessage.id}-${index}`}
                          part={part}
                          role="user"
                        />
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

                    {!isBusy &&
                      latestToolPart === null &&
                      latestAssistantTextPart !== null && (
                        <MessagePart
                          part={latestAssistantTextPart}
                          role="assistant"
                        />
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

            <section
              aria-hidden={activeView !== "clickhouse"}
              className="h-full min-h-0"
              hidden={activeView !== "clickhouse"}
            >
              <ClickHouseView
                onAskOverview={() =>
                  submitQuestion("Show me what this data looks like")
                }
                profile={initialDataSourceProfile}
                source={activeSource}
              />
            </section>
            <section
              aria-hidden={activeView !== "performance"}
              className="h-full min-h-0"
              hidden={activeView !== "performance"}
            >
              <PerformanceView focus={performanceFocus} />
            </section>
            <section
              aria-hidden={activeView !== "history"}
              className="h-full min-h-0"
              hidden={activeView !== "history"}
            >
              <HistoryView onAskAgain={askAgain} questions={sessionQuestions} />
            </section>
          </main>

          {showComposer && (
            <form
              className="mx-4 mb-4 flex min-w-0 items-center gap-3 rounded-2xl border border-white/90 bg-white/78 p-2 pl-4 shadow-[0_16px_38px_rgb(45_57_84_/_10%)] backdrop-blur-2xl transition-shadow focus-within:ring-2 focus-within:ring-[#8796d6]/55 sm:mx-6"
              onSubmit={handleSubmit}
            >
              <label className="sr-only" htmlFor="question">
                Data question
              </label>
              <Plus
                aria-hidden="true"
                className="size-4 shrink-0 text-[var(--ink-tertiary)]"
              />
              <input
                className="h-11 min-w-0 flex-1 border-0 bg-transparent text-sm text-[var(--ink)] outline-none placeholder:text-[var(--ink-tertiary)]"
                id="question"
                onChange={(event) => setInput(event.target.value)}
                placeholder="Ask about trends, groups, distributions or anomalies…"
                value={input}
              />
              {isBusy ? (
                <Button
                  aria-label="Stop analysis"
                  className="size-11 shrink-0 rounded-xl"
                  onClick={() => void stop()}
                  type="button"
                  variant="outline"
                >
                  <Square
                    aria-hidden="true"
                    className="size-3.5 fill-current"
                  />
                </Button>
              ) : (
                <Button
                  aria-label="Ask Lens"
                  className="size-11 shrink-0 rounded-xl bg-[var(--lens-dark)] text-white shadow-none hover:bg-[#3a4050]"
                  type="submit"
                >
                  <ArrowUp aria-hidden="true" className="size-4" />
                </Button>
              )}
            </form>
          )}
        </div>
      </section>
    </AnalysisNavigationProvider>
  );
}

export function PropertyChat(props: PropertyChatProps) {
  return (
    <AnalysisPerformanceProvider triggerSessionId={props.chatId}>
      <PropertyChatWorkspace {...props} />
    </AnalysisPerformanceProvider>
  );
}
