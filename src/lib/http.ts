import type { z } from "zod";

export function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export function formatZodErrors(
  error: z.ZodError,
  messageFor?: (issue: z.core.$ZodIssue) => string | undefined,
): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path[0];
    if (typeof key !== "string" || key in errors) continue;
    errors[key] = messageFor?.(issue) ?? issue.message;
  }
  return errors;
}

export function formatApplicationErrors(error: z.ZodError): Record<string, string> {
  return formatZodErrors(error, (issue) => {
    const key = issue.path[0];
    if (key === "source" && (issue.code === "too_small" || issue.code === "invalid_type")) {
      return "Źródło jest wymagane.";
    }
    return undefined;
  });
}
