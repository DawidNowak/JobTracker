import type { APIRoute } from "astro";
import { applicationParseSchema } from "@/lib/validation/applications";
import { recognize } from "@/lib/parsers/recognize";
import { parseLinkedIn } from "@/lib/parsers/linkedin";
import { parseJustJoinIT } from "@/lib/parsers/justjoinit";
import type { ParseEndpointResponse } from "@/lib/parsers/types";
import { resolveStatus } from "@/lib/parsers/status";
import { jsonResponse, formatZodErrors } from "@/lib/http";

export const prerender = false;

function formatParseErrors(error: Parameters<typeof formatZodErrors>[0]) {
  return formatZodErrors(error, (issue) => {
    const key = issue.path[0];
    if (key === "source" && (issue.code === "too_small" || issue.code === "invalid_type")) {
      return "Źródło jest wymagane.";
    }
    return undefined;
  });
}

const MESSAGES = {
  unsupported: "Nieobsługiwany portal. Wypełnij dane ręcznie.",
  fetch_failed: "Nie udało się pobrać danych. Wypełnij ręcznie.",
  empty: "Nie udało się pobrać danych. Wypełnij ręcznie.",
  partial: "Wypełniono częściowo. Uzupełnij brakujące pola.",
} as const;

export const POST: APIRoute = async (context) => {
  const user = context.locals.user;
  if (!user) {
    return jsonResponse(401, { error: "Brak autoryzacji." });
  }

  let body: unknown;
  try {
    body = await context.request.json();
  } catch {
    return jsonResponse(400, { error: "Nieprawidłowe żądanie" });
  }

  const parsed = applicationParseSchema.safeParse(body);
  if (!parsed.success) {
    return jsonResponse(422, { errors: formatParseErrors(parsed.error) });
  }

  const trimmed = parsed.data.source.trim();
  const recognized = recognize(trimmed);
  if (!recognized) {
    const payload: ParseEndpointResponse = {
      result: {},
      status: "unsupported",
      message: MESSAGES.unsupported,
    };
    return jsonResponse(200, payload);
  }

  try {
    const result =
      recognized.kind === "linkedin" ? await parseLinkedIn(recognized.jobId) : await parseJustJoinIT(recognized.slug);

    const status = resolveStatus(result, recognized.kind);
    const payload: ParseEndpointResponse = { result, status };
    if (status === "partial") payload.message = MESSAGES.partial;
    if (status === "empty") payload.message = MESSAGES.empty;
    return jsonResponse(200, payload);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("Parse endpoint failed", err);
    const payload: ParseEndpointResponse = {
      result: {},
      status: "fetch_failed",
      message: MESSAGES.fetch_failed,
    };
    return jsonResponse(200, payload);
  }
};
