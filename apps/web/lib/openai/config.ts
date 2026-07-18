import { z } from "zod";

const openAIEnvironmentSchema = z.object({
  OPENAI_API_KEY: z.string().min(1),
  OPENAI_MODEL: z.string().min(1).default("gpt-5.6-terra"),
});

export type OpenAIConfig = {
  readonly apiKey: string;
  readonly model: string;
};

export function getOpenAIConfig(): OpenAIConfig {
  const environment = openAIEnvironmentSchema.parse(process.env);

  return {
    apiKey: environment.OPENAI_API_KEY,
    model: environment.OPENAI_MODEL,
  };
}
