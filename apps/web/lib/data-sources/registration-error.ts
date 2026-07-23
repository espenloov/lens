import { z } from "zod";

export function registrationFailureMessage(
  error: { readonly message: string } | undefined,
  phase: string | undefined,
): string {
  const message = error?.message.trim();

  if (message !== undefined && message.length > 0) {
    try {
      const issues = z
        .array(z.object({ message: z.string().min(1) }))
        .safeParse(JSON.parse(message));

      if (issues.success) {
        return issues.data[0]?.message ?? "Dataset validation failed";
      }
    } catch {
      return message.slice(0, 320);
    }

    return message.slice(0, 320);
  }

  return phase === undefined
    ? "Dataset validation failed"
    : `Dataset validation failed during ${phase.replaceAll("_", " ")}`;
}
