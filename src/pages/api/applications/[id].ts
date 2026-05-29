import type { APIRoute } from "astro";
import { z } from "zod";
import { createClient } from "@/lib/supabase";
import { applicationStatusUpdateSchema } from "@/lib/validation/applications";
import { updateApplicationStatus } from "@/lib/services/applications";

export const prerender = false;

const uuidSchema = z.uuid();

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function formatStatusErrors(error: z.ZodError): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path[0];
    if (typeof key !== "string" || key in errors) continue;
    errors[key] = issue.message;
  }
  return errors;
}

export const PATCH: APIRoute = async (context) => {
  const user = context.locals.user;
  if (!user) {
    return jsonResponse(401, { error: "Brak autoryzacji." });
  }

  const idParam = context.params.id;
  if (typeof idParam !== "string" || !uuidSchema.safeParse(idParam).success) {
    return jsonResponse(400, { error: "Nieprawidłowy identyfikator." });
  }

  let body: unknown;
  try {
    body = await context.request.json();
  } catch {
    return jsonResponse(400, { error: "Nieprawidłowe żądanie" });
  }

  const parsed = applicationStatusUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return jsonResponse(422, { errors: formatStatusErrors(parsed.error) });
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return jsonResponse(500, { error: "Supabase nie jest skonfigurowany." });
  }

  try {
    const row = await updateApplicationStatus(supabase, idParam, parsed.data.status, user.id);
    if (!row) {
      return jsonResponse(404, { error: "Nie znaleziono aplikacji." });
    }
    return jsonResponse(200, { application: row });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("Failed to update application status", err);
    return jsonResponse(500, { error: "Nie udało się zaktualizować aplikacji." });
  }
};
