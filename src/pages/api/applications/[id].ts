import type { APIRoute } from "astro";
import { z } from "zod";
import { createClient } from "@/lib/supabase";
import { applicationUpdateSchema } from "@/lib/validation/applications";
import { updateApplication, deleteApplication } from "@/lib/services/applications";
import { jsonResponse, formatApplicationErrors } from "@/lib/http";

export const prerender = false;

const uuidSchema = z.uuid();

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

  const parsed = applicationUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return jsonResponse(422, { errors: formatApplicationErrors(parsed.error) });
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return jsonResponse(500, { error: "Supabase nie jest skonfigurowany." });
  }

  try {
    const row = await updateApplication(supabase, idParam, parsed.data, user.id);
    if (!row) {
      return jsonResponse(404, { error: "Nie znaleziono aplikacji." });
    }
    return jsonResponse(200, { application: row });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("Failed to update application", err);
    return jsonResponse(500, { error: "Nie udało się zaktualizować aplikacji." });
  }
};

export const DELETE: APIRoute = async (context) => {
  const user = context.locals.user;
  if (!user) {
    return jsonResponse(401, { error: "Brak autoryzacji." });
  }

  const idParam = context.params.id;
  if (typeof idParam !== "string" || !uuidSchema.safeParse(idParam).success) {
    return jsonResponse(400, { error: "Nieprawidłowy identyfikator." });
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return jsonResponse(500, { error: "Supabase nie jest skonfigurowany." });
  }

  try {
    const deleted = await deleteApplication(supabase, idParam, user.id);
    if (!deleted) {
      return jsonResponse(404, { error: "Nie znaleziono aplikacji." });
    }
    return jsonResponse(200, { ok: true });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("Failed to delete application", err);
    return jsonResponse(500, { error: "Nie udało się usunąć aplikacji." });
  }
};
