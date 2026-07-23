"use client";

import {
  createContext,
  useContext,
  type ReactNode,
} from "react";
import { ArrowRight, Sparkles } from "lucide-react";

export type AnalysisDeepDiveAction = {
  readonly label: string;
  readonly prompt: string;
};

type AnalysisExplorationContextValue = {
  readonly runDeepDive: (action: AnalysisDeepDiveAction) => void;
};

const AnalysisExplorationContext =
  createContext<AnalysisExplorationContextValue | null>(null);

export function AnalysisExplorationProvider({
  children,
  runDeepDive,
}: {
  readonly children: ReactNode;
  readonly runDeepDive: (action: AnalysisDeepDiveAction) => void;
}) {
  return (
    <AnalysisExplorationContext.Provider value={{ runDeepDive }}>
      {children}
    </AnalysisExplorationContext.Provider>
  );
}

export function useAnalysisExploration() {
  return useContext(AnalysisExplorationContext);
}

export function DeepDiveActions({
  actions,
  prompt,
}: {
  readonly actions: readonly AnalysisDeepDiveAction[];
  readonly prompt: string;
}) {
  const exploration = useAnalysisExploration();

  if (exploration === null) {
    return null;
  }

  if (actions.length === 0) {
    return (
      <div className="deep-dive-hint">
        <Sparkles aria-hidden="true" className="size-3.5" />
        <span>{prompt}</span>
      </div>
    );
  }

  return (
    <div className="deep-dive-dock" role="group" aria-label="Explore deeper">
      <div className="deep-dive-dock-label">
        <Sparkles aria-hidden="true" className="size-3.5" />
        Explore this
      </div>
      <div className="flex min-w-0 flex-1 flex-wrap gap-2">
        {actions.slice(0, 2).map((action) => (
          <button
            className="deep-dive-action group"
            key={`${action.label}:${action.prompt}`}
            onClick={() => exploration.runDeepDive(action)}
            type="button"
          >
            <span>{action.label}</span>
            <ArrowRight
              aria-hidden="true"
              className="size-3.5 transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none"
            />
          </button>
        ))}
      </div>
    </div>
  );
}
