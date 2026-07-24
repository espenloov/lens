import { z } from "zod";

export function registrationFailureMessage(
  error: { readonly message: string } | undefined,
  phase: string | undefined,
): string {
  const message = error?.message.trim();

  if (message !== undefined && message.length > 0) {
    try {
      const issues = z
        .array(
          z.object({
            message: z.string().min(1),
            path: z
              .array(z.union([z.string(), z.number()]))
              .optional(),
          }),
        )
        .safeParse(JSON.parse(message));

      if (issues.success) {
        const issue = issues.data[0];

        if (issue === undefined) {
          return "Dataset validation failed";
        }

        const path = issue.path?.join(".");
        return path === undefined || path.length === 0
          ? issue.message
          : `${path}: ${issue.message}`;
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
