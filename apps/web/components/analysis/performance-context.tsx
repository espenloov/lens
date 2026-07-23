"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ResultAsync } from "neverthrow";

import { getPropertyChatRunDetails } from "@/app/actions/chat";
import type { QueryStrategy } from "@/lib/query-arena/contracts";
import type { TriggerRunDetails } from "@/lib/trigger/run-details";

export type AnalysisFailureStage =
  | "agent"
  | "clickhouse"
  | "arrow"
  | "rust";

export type QueryArenaEvidence = {
  readonly runId: string | null;
  readonly status: "queued" | "running" | "completed" | "failed";
  readonly phase: string | null;
  readonly progress: number;
  readonly currentStrategy: QueryStrategy;
  readonly winner: QueryStrategy | null;
  readonly speedup: number | null;
  readonly verified: boolean | null;
  readonly historyStored: boolean | null;
  readonly recipeStored: boolean | null;
  readonly error: string | null;
};

export type AnalysisPerformanceInput = {
  readonly title: string;
  readonly kind: string;
  readonly queryId: string | null;
  readonly contract: string;
  readonly arrowBytes: number;
  readonly typedRows: number;
  readonly roundTripMs: number;
  readonly wasmStartupMs: number;
  readonly rustDecodeMs: number;
  readonly rustComputeMs: number;
};

export type AnalysisPerformanceReport = AnalysisPerformanceInput & {
  readonly id: string;
  readonly question: string;
  readonly dataset: string;
  readonly datasetVersion: number;
  readonly triggerSessionId: string;
  readonly triggerMs: number;
  readonly totalMs: number;
  readonly completedAt: string;
  readonly status: "completed" | "failed";
  readonly failedStage: AnalysisFailureStage | null;
  readonly errorMessage: string | null;
  readonly triggerRun: TriggerRunDetails | null;
  readonly queryArena: QueryArenaEvidence | null;
};

type PendingAnalysis = {
  readonly question: string;
  readonly dataset: string;
  readonly datasetVersion: number;
  readonly startedAt: number;
  planReadyAt: number | null;
};

type AnalysisPerformanceContextValue = {
  readonly reports: readonly AnalysisPerformanceReport[];
  readonly latest: AnalysisPerformanceReport | null;
  readonly beginAnalysis: (
    question: string,
    dataset: string,
    datasetVersion: number,
  ) => void;
  readonly markPlanReady: () => void;
  readonly reportAnalysis: (input: AnalysisPerformanceInput) => void;
  readonly failAnalysis: (
    stage: AnalysisFailureStage,
    message: string,
  ) => void;
  readonly updateQueryArena: (
    reportId: string,
    evidence: QueryArenaEvidence,
  ) => void;
  readonly refreshLatestTriggerRun: () => void;
};

const AnalysisPerformanceContext =
  createContext<AnalysisPerformanceContextValue | null>(null);

function failedInput(question: string): AnalysisPerformanceInput {
  return {
    title: question,
    kind: "failed",
    queryId: null,
    contract: "unavailable",
    arrowBytes: 0,
    typedRows: 0,
    roundTripMs: 0,
    wasmStartupMs: 0,
    rustDecodeMs: 0,
    rustComputeMs: 0,
  };
}

export function AnalysisPerformanceProvider({
  children,
  triggerSessionId,
}: {
  readonly children: ReactNode;
  readonly triggerSessionId: string;
}) {
  const pending = useRef<PendingAnalysis | null>(null);
  const pendingArena = useRef(new Map<string, QueryArenaEvidence>());
  const [reports, setReports] = useState<readonly AnalysisPerformanceReport[]>(
    [],
  );

  const attachTriggerRun = useCallback(
    (reportId: string) => {
      void ResultAsync.fromPromise(
        getPropertyChatRunDetails(triggerSessionId),
        (cause) => cause,
      ).map((triggerRun) => {
        if (triggerRun === null) {
          return;
        }

        const triggerError =
          [...triggerRun.attempts]
            .reverse()
            .find((attempt) => attempt.errorMessage !== null)?.errorMessage ??
          null;

        setReports((current) =>
          current.map((report) =>
            report.id === reportId
              ? {
                  ...report,
                  triggerRun,
                  errorMessage:
                    report.failedStage === "agent" && triggerError !== null
                      ? triggerError
                      : report.errorMessage,
                }
              : report,
          ),
        );
      });
    },
    [triggerSessionId],
  );

  const beginAnalysis = useCallback(
    (question: string, dataset: string, datasetVersion: number) => {
      pending.current = {
        question,
        dataset,
        datasetVersion,
        startedAt: performance.now(),
        planReadyAt: null,
      };
    },
    [],
  );

  const markPlanReady = useCallback(() => {
    if (pending.current !== null && pending.current.planReadyAt === null) {
      pending.current.planReadyAt = performance.now();
    }
  }, []);

  const reportAnalysis = useCallback(
    (input: AnalysisPerformanceInput) => {
      const active = pending.current;

      if (active === null) {
        return;
      }

      const completedAt = performance.now();
      const planReadyAt = active.planReadyAt ?? completedAt;
      const id =
        input.queryId ??
        `${active.dataset}:${active.datasetVersion}:${Math.round(active.startedAt)}`;
      const report: AnalysisPerformanceReport = {
        ...input,
        id,
        question: active.question,
        dataset: active.dataset,
        datasetVersion: active.datasetVersion,
        triggerSessionId,
        triggerMs: Math.max(0, planReadyAt - active.startedAt),
        totalMs: Math.max(0, completedAt - active.startedAt),
        completedAt: new Date().toISOString(),
        status: "completed",
        failedStage: null,
        errorMessage: null,
        triggerRun: null,
        queryArena: pendingArena.current.get(id) ?? null,
      };

      pending.current = null;
      setReports((current) => {
        const withoutDuplicate = current.filter(
          (candidate) => candidate.id !== report.id,
        );
        return [report, ...withoutDuplicate].slice(0, 8);
      });
      attachTriggerRun(report.id);
    },
    [attachTriggerRun, triggerSessionId],
  );

  const failAnalysis = useCallback(
    (stage: AnalysisFailureStage, message: string) => {
      const active = pending.current;

      if (active === null) {
        return;
      }

      const completedAt = performance.now();
      const planReadyAt = active.planReadyAt ?? completedAt;
      const id = `failed:${active.dataset}:${Math.round(active.startedAt)}`;
      const report: AnalysisPerformanceReport = {
        ...failedInput(active.question),
        id,
        question: active.question,
        dataset: active.dataset,
        datasetVersion: active.datasetVersion,
        triggerSessionId,
        triggerMs: Math.max(0, planReadyAt - active.startedAt),
        totalMs: Math.max(0, completedAt - active.startedAt),
        completedAt: new Date().toISOString(),
        status: "failed",
        failedStage: stage,
        errorMessage: message,
        triggerRun: null,
        queryArena: null,
      };

      pending.current = null;
      setReports((current) => [report, ...current].slice(0, 8));
      attachTriggerRun(report.id);
    },
    [attachTriggerRun, triggerSessionId],
  );

  const updateQueryArena = useCallback(
    (reportId: string, evidence: QueryArenaEvidence) => {
      pendingArena.current.set(reportId, evidence);
      setReports((current) =>
        current.map((report) =>
          report.id === reportId
            ? { ...report, queryArena: evidence }
            : report,
        ),
      );
    },
    [],
  );

  const latestReportId = reports[0]?.id;
  const refreshLatestTriggerRun = useCallback(() => {
    const reportId = latestReportId;

    if (reportId !== undefined) {
      attachTriggerRun(reportId);
    }
  }, [attachTriggerRun, latestReportId]);

  const value = useMemo<AnalysisPerformanceContextValue>(
    () => ({
      reports,
      latest: reports[0] ?? null,
      beginAnalysis,
      markPlanReady,
      reportAnalysis,
      failAnalysis,
      updateQueryArena,
      refreshLatestTriggerRun,
    }),
    [
      beginAnalysis,
      failAnalysis,
      markPlanReady,
      refreshLatestTriggerRun,
      reportAnalysis,
      reports,
      updateQueryArena,
    ],
  );

  return (
    <AnalysisPerformanceContext.Provider value={value}>
      {children}
    </AnalysisPerformanceContext.Provider>
  );
}

export function useAnalysisPerformance(): AnalysisPerformanceContextValue {
  const value = useContext(AnalysisPerformanceContext);

  if (value === null) {
    throw new Error(
      "useAnalysisPerformance must be used inside AnalysisPerformanceProvider",
    );
  }

  return value;
}
