import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { applicationCreateSchema } from "@/lib/validation/applications";
import { createApplication } from "@/lib/services/applications";
import { jsonResponse, formatZodErrors } from "@/lib/http";

export const prerender = false;

function formatApplicationErrors(error: Parameters<typeof formatZodErrors>[0]) {
  return formatZodErrors(error, (issue) => {
    const key = issue.path[0];
    if (key === "source" && (issue.code === "too_small" || issue.code === "invalid_type")) {
      return "Źródło jest wymagane.";
    }
    return undefined;
  });
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

  const parsed = applicationCreateSchema.safeParse(body);
  if (!parsed.success) {
    return jsonResponse(422, { errors: formatApplicationErrors(parsed.error) });
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return jsonResponse(500, { error: "Supabase nie jest skonfigurowany." });
  }

  try {
    const row = await createApplication(supabase, parsed.data, user.id);
    return jsonResponse(201, { application: row });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("Failed to insert application", err);
    return jsonResponse(500, { error: "Nie udało się zapisać aplikacji." });
  }
};
