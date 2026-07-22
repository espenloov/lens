"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";

import { preloadTimeSeriesWasm } from "@/lib/wasm/time-series";

export function QueryProvider({ children }: { readonly children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            refetchOnWindowFocus: false,
            staleTime: 5 * 60 * 1_000,
          },
        },
      }),
  );

  useEffect(() => {
    void preloadTimeSeriesWasm().match(
      () => undefined,
      () => undefined,
    );
  }, []);

  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}
