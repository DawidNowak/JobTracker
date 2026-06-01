import type { APIRoute } from "astro";
import { applicationParseSchema, formatApplicationFieldErrors } from "@/lib/validation/applications";
import { recognize } from "@/lib/parsers/recognize";
import { parseLinkedIn } from "@/lib/parsers/linkedin";
import { parseJustJoinIT } from "@/lib/parsers/justjoinit";
import type { ParseEndpointResponse, ParseResult, ParseStatus } from "@/lib/parsers/types";

export const prerender = false;

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const MESSAGES = {
  unsupported: "Nieobsługiwany portal. Wypełnij dane ręcznie.",
  fetch_failed: "Nie udało się pobrać danych. Wypełnij ręcznie.",
  empty: "Nie udało się pobrać danych. Wypełnij ręcznie.",
  partial: "Wypełniono częściowo. Uzupełnij brakujące pola.",
} as const;

const EXPECTED_KEYS: Record<"linkedin" | "jjit", (keyof ParseResult)[]> = {
  linkedin: ["position", "company", "description"],
  jjit: ["position", "company", "description", "salary", "work_mode"],
};

function countDefined(result: ParseResult): number {
  return (Object.keys(result) as (keyof ParseResult)[]).filter((k) => result[k] !== undefined).length;
}

function resolveStatus(result: ParseResult, kind: "linkedin" | "jjit"): ParseStatus {
  const populated = countDefined(result);
  if (populated === 0) return "empty";
  const expected = EXPECTED_KEYS[kind];
  const missingExpected = expected.some((k) => result[k] === undefined);
  return missingExpected ? "partial" : "ok";
}

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
    return jsonResponse(422, { errors: formatApplicationFieldErrors(parsed.error) });
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
