import { createOpenAI } from "@ai-sdk/openai";
import { ai, chat } from "@trigger.dev/sdk/ai";
import type { InferChatUIMessageFromTools } from "@trigger.dev/sdk/ai";
import { stepCountIs, streamText, tool } from "ai";

import { analysisPlanSchema } from "@/lib/analysis/contracts";
import { propertyAgentSystemPrompt } from "@/lib/analysis/system-prompt";
import { getOpenAIConfig } from "@/lib/openai/config";

import { submitAnalysisPlanTask } from "./submit-analysis-plan";

const submitAnalysisPlan = tool({
  description: submitAnalysisPlanTask.description ?? "",
  inputSchema: analysisPlanSchema,
  execute: ai.toolExecute(submitAnalysisPlanTask),
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
