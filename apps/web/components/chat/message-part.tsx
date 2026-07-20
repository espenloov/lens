import type { ReactNode } from "react";

import { AnalysisResult } from "@/components/analysis/analysis-result";
import { parseAnalysisToolOutput } from "@/lib/analysis/tool-output";
import type { PropertyAgentUIMessage } from "@/src/trigger/property-agent";

type PropertyAgentMessagePart = PropertyAgentUIMessage["parts"][number];

type MessagePartProps = {
  readonly part: PropertyAgentMessagePart;
  readonly role: PropertyAgentUIMessage["role"];
};

function ToolStatus({ children }: { readonly children: ReactNode }) {
  return (
    <p
      className="text-sm text-muted-foreground"
      role="status"
      aria-live="polite"
    >
      {children}
    </p>
  );
}

export function MessagePart({ part, role }: MessagePartProps) {
  if (part.type === "text") {
    if (!part.text) {
      return null;
    }

    return (
      <p
        className={
          role === "user"
            ? "rounded-xl bg-foreground px-4 py-3 text-background"
            : "max-w-2xl rounded-xl bg-muted px-4 py-3"
        }
      >
        {part.text}
      </p>
    );
  }

  if (part.type !== "tool-submitAnalysisPlan") {
    return null;
  }

  switch (part.state) {
    case "input-streaming":
      return <ToolStatus>Preparing the analysis…</ToolStatus>;

    case "input-available":
    case "approval-requested":
    case "approval-responded":
      return <ToolStatus>Querying ClickHouse…</ToolStatus>;

    case "output-available": {
      const output = parseAnalysisToolOutput(part.output);

      if (!output.success) {
        return (
          <p className="text-sm text-destructive" role="alert">
            Lens received an analysis result it could not safely display.
          </p>
        );
      }

      return <AnalysisResult output={output.data} />;
    }

    case "output-error":
      return (
        <p className="text-sm text-destructive" role="alert">
          The property analysis failed. Please try again.
        </p>
      );

    case "output-denied":
      return (
        <p className="text-sm text-muted-foreground">
          The property analysis was not run.
        </p>
      );
  }
}
