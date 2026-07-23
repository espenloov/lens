"use client";

import {
  createContext,
  useContext,
  type ReactNode,
} from "react";

export type PerformanceFocus = "flow" | "arena";

type AnalysisNavigationContextValue = {
  readonly openPerformance: (focus?: PerformanceFocus) => void;
};

const AnalysisNavigationContext =
  createContext<AnalysisNavigationContextValue | null>(null);

export function AnalysisNavigationProvider({
  children,
  openPerformance,
}: {
  readonly children: ReactNode;
  readonly openPerformance: (focus?: PerformanceFocus) => void;
}) {
  return (
    <AnalysisNavigationContext.Provider value={{ openPerformance }}>
      {children}
    </AnalysisNavigationContext.Provider>
  );
}

export function useAnalysisNavigation(): AnalysisNavigationContextValue {
  const value = useContext(AnalysisNavigationContext);

  if (value === null) {
    throw new Error(
      "useAnalysisNavigation must be used inside AnalysisNavigationProvider",
    );
  }

  return value;
}
