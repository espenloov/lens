import { createOpenAI } from "@ai-sdk/openai";
import { chat } from "@trigger.dev/sdk/ai";
import type { InferChatUIMessageFromTools } from "@trigger.dev/sdk/ai";
import { stepCountIs, streamText, tool } from "ai";
import { z } from "zod";

import { analysisPlanSchema } from "@/lib/analysis/contracts";
import { prepareAnalysis } from "@/lib/analysis/prepare-analysis";
import {
  prepareSemanticAnalysis,
  semanticAnalysisPlanSchema,
} from "@/lib/analysis/semantic-plan";
import {
  buildPropertyAgentSystemPrompt,
  buildSemanticAgentSystemPrompt,
} from "@/lib/analysis/system-prompt";
import { BUILTIN_DATA_SOURCE } from "@/lib/data-sources/builtin";
import { datasetSlugSchema } from "@/lib/data-sources/contracts";
import type { AnalysisDataSource } from "@/lib/data-sources/contracts";
import { getAnalysisDataSource } from "@/lib/data-sources/registry";
import { getOpenAIConfig } from "@/lib/openai/config";

const propertyAgentClientDataSchema = z.object({
  dataset: datasetSlugSchema,
  datasetVersion: z.number().int().positive(),
});

function createPropertyAgentTools(source: AnalysisDataSource) {
  return {
    submitAnalysisPlan: tool({
      description:
        "Execute a structured property-transaction analysis plan using ClickHouse.",
      inputSchema: analysisPlanSchema,
      execute: async (plan) => {
        if (plan.dataset !== source.slug) {
          return {
            status: "unsupported" as const,
            plan,
            error: {
              type: "unsupported_analysis_plan" as const,
              message: `This chat is pinned to ${source.slug} version ${source.version}`,
            },
          };
        }

        if (source.dateFrom === null || source.dateTo === null) {
          return {
            status: "unsupported" as const,
            plan,
            error: {
              type: "unsupported_analysis_plan" as const,
              message: "This dataset does not declare a time field",
            },
          };
        }

        return prepareAnalysis(plan, {
          dateFrom: source.dateFrom,
          dateTo: source.dateTo,
          version: source.version,
        });
      },
    }),
  };
}

function createSemanticAgentTools(source: AnalysisDataSource) {
  return {
    submitSemanticAnalysisPlan: tool({
      description:
        "Execute a manifest-validated analytical plan using ClickHouse and typed Arrow.",
      inputSchema: semanticAnalysisPlanSchema,
      execute: async (plan) => {
        const prepared = prepareSemanticAnalysis(plan, source.manifest, {
          dataset: source.slug,
          datasetVersion: source.version,
        });

        return prepared.isOk()
          ? {
              status: "ready" as const,
              plan,
              request: prepared.value,
            }
          : {
              status: "unsupported" as const,
              plan,
              error: prepared.error,
            };
      },
    }),
  };
}

export const propertyAgentTools = createPropertyAgentTools(
  BUILTIN_DATA_SOURCE,
);
type AllAgentTools = typeof propertyAgentTools &
  ReturnType<typeof createSemanticAgentTools>;

export type PropertyAgentUIMessage = InferChatUIMessageFromTools<
  AllAgentTools
>;

function getModel() {
  const config = getOpenAIConfig();
  const openai = createOpenAI({ apiKey: config.apiKey });

  return openai(config.model);
}

export const propertyAgent = chat
  .withUIMessage<PropertyAgentUIMessage>()
  .withClientData({ schema: propertyAgentClientDataSchema })
  .agent({
    id: "property-agent",
    tools: async ({ clientData }) => {
      if (clientData === undefined) {
        throw new Error("The chat is missing its pinned dataset context");
      }

      const source = await getAnalysisDataSource(
        clientData.dataset,
        clientData.datasetVersion,
      );

      if (source.isErr()) {
        throw new Error(source.error.message, { cause: source.error.cause });
      }

      return source.value.builtin
        ? createPropertyAgentTools(source.value)
        : createSemanticAgentTools(source.value);
    },
    maxTurns: 10,
    turnTimeout: "10m",
    idleTimeoutInSeconds: 10,
    preloadIdleTimeoutInSeconds: 30,
    preloadTimeout: "2m",

    onChatStart: async ({ clientData }) => {
      const source = await getAnalysisDataSource(
        clientData.dataset,
        clientData.datasetVersion,
      );

      if (source.isErr()) {
        throw new Error(source.error.message, { cause: source.error.cause });
      }

      chat.prompt.set(
        source.value.builtin
          ? buildPropertyAgentSystemPrompt(source.value)
          : buildSemanticAgentSystemPrompt(source.value),
      );
    },

    run: async ({ messages, tools, signal }) => {
      return streamText({
        ...chat.toStreamTextOptions({ tools }),
        model: getModel(),
        messages,
        abortSignal: signal,
        stopWhen: stepCountIs(5),
      });
    },
  });
