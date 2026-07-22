import { createOpenAI } from "@ai-sdk/openai";
import { chat } from "@trigger.dev/sdk/ai";
import type { InferChatUIMessageFromTools } from "@trigger.dev/sdk/ai";
import { stepCountIs, streamText, tool } from "ai";

import { analysisPlanSchema } from "@/lib/analysis/contracts";
import { prepareAnalysis } from "@/lib/analysis/prepare-analysis";
import { propertyAgentSystemPrompt } from "@/lib/analysis/system-prompt";
import { getOpenAIConfig } from "@/lib/openai/config";

const submitAnalysisPlan = tool({
  description: "Execute a structured UK property-market analysis plan using ClickHouse.",
  inputSchema: analysisPlanSchema,
  execute: async (plan) => prepareAnalysis(plan),
});

export const propertyAgentTools = {
  submitAnalysisPlan,
};

export type PropertyAgentUIMessage = InferChatUIMessageFromTools<
  typeof propertyAgentTools
>;

function getModel() {
  const config = getOpenAIConfig();
  const openai = createOpenAI({ apiKey: config.apiKey });

  return openai(config.model);
}

export const propertyAgent = chat
  .withUIMessage<PropertyAgentUIMessage>()
  .agent({
    id: "property-agent",
    tools: propertyAgentTools,
    maxTurns: 10,
    turnTimeout: "10m",
    idleTimeoutInSeconds: 10,

    onChatStart: async () => {
      chat.prompt.set(propertyAgentSystemPrompt);
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
