import type { ReactNode } from "react";

import { AnalysisResult } from "@/components/analysis/analysis-result";
import { AnalysisFailureNotice } from "@/components/analysis/analysis-failure-notice";
import { SemanticAnalysisResult } from "@/components/analysis/semantic-analysis-result";
import { parseSemanticAnalysisToolOutput } from "@/lib/analysis/semantic-tool-output";
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
      className="text-sm text-slate-500"
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

    return role === "user" ? (
      <div className="flex items-center gap-3 border-l-2 border-[#21c5be] py-0.5 pl-3">
        <p className="shrink-0 text-xs font-medium text-[#66758e]">Current question</p>
        <p className="truncate text-sm font-medium leading-5 text-[#09265b]">
          {part.text}
        </p>
      </div>
    ) : (
      <p className="max-w-3xl text-sm leading-6 text-slate-600">
        {part.text}
      </p>
    );
  }

  if (part.type === "tool-submitSemanticAnalysisPlan") {
    switch (part.state) {
      case "input-streaming":
        return <ToolStatus>Preparing the dataset analysis…</ToolStatus>;

      case "input-available":
      case "approval-requested":
      case "approval-responded":
        return <ToolStatus>Validating the dataset grammar…</ToolStatus>;

      case "output-available": {
        const output = parseSemanticAnalysisToolOutput(part.output);

        if (!output.success) {
          return (
            <AnalysisFailureNotice
              message="Lens received a semantic result it could not safely display."
              stage="agent"
            >
              <p className="text-sm text-destructive">
                Lens received a semantic result it could not safely display.
              </p>
            </AnalysisFailureNotice>
          );
        }

        return <SemanticAnalysisResult output={output.data} />;
      }

      case "output-error":
        return (
          <AnalysisFailureNotice
            message="The dataset analysis task failed."
            stage="agent"
          >
            <p className="text-sm text-destructive">
              The dataset analysis failed. Please try again.
            </p>
          </AnalysisFailureNotice>
        );

      case "output-denied":
        return (
          <p className="text-sm text-muted-foreground">
            The dataset analysis was not run.
          </p>
        );
    }
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
      return <ToolStatus>Preparing a safe analysis…</ToolStatus>;

    case "output-available": {
      const output = parseAnalysisToolOutput(part.output);

      if (!output.success) {
        return (
          <AnalysisFailureNotice
            message="Lens received an analysis result it could not safely display."
            stage="agent"
          >
            <p className="text-sm text-destructive">
              Lens received an analysis result it could not safely display.
            </p>
          </AnalysisFailureNotice>
        );
      }

      return <AnalysisResult output={output.data} />;
    }

    case "output-error":
      return (
        <AnalysisFailureNotice
          message="The property analysis task failed."
          stage="agent"
        >
          <p className="text-sm text-destructive">
            The property analysis failed. Please try again.
          </p>
        </AnalysisFailureNotice>
      );

    case "output-denied":
      return (
        <p className="text-sm text-muted-foreground">
          The property analysis was not run.
        </p>
      );
  }
}
