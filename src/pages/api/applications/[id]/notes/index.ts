import type { APIRoute } from "astro";
import { z } from "zod";
import { createClient } from "@/lib/supabase";
import { applicationNoteBodySchema } from "@/lib/validation/applications";
import { listNotes, createNote } from "@/lib/services/notes";
import { jsonResponse, formatZodErrors } from "@/lib/http";

export const prerender = false;

const uuidSchema = z.uuid();

export const GET: APIRoute = async (context) => {
  const user = context.locals.user;
  if (!user) {
    return jsonResponse(401, { error: "Brak autoryzacji." });
  }

  const idParam = context.params.id;
  if (!idParam || !uuidSchema.safeParse(idParam).success) {
    return jsonResponse(400, { error: "Nieprawidłowy identyfikator." });
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return jsonResponse(500, { error: "Supabase nie jest skonfigurowany." });
  }

  try {
    const notes = await listNotes(supabase, idParam, user.id);
    return jsonResponse(200, { notes });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("Failed to list notes", err);
    return jsonResponse(500, { error: "Nie udało się pobrać notatek." });
  }
};

export const POST: APIRoute = async (context) => {
  const user = context.locals.user;
  if (!user) {
    return jsonResponse(401, { error: "Brak autoryzacji." });
  }

  const idParam = context.params.id;
  if (!idParam || !uuidSchema.safeParse(idParam).success) {
    return jsonResponse(400, { error: "Nieprawidłowy identyfikator." });
  }

  let body: unknown;
  try {
    body = await context.request.json();
  } catch {
    return jsonResponse(400, { error: "Nieprawidłowe żądanie." });
  }

  const parsed = applicationNoteBodySchema.safeParse(body);
  if (!parsed.success) {
    return jsonResponse(422, { errors: formatZodErrors(parsed.error) });
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return jsonResponse(500, { error: "Supabase nie jest skonfigurowany." });
  }

  try {
    const note = await createNote(supabase, idParam, parsed.data.body, user.id);
    return jsonResponse(201, { note });
  } catch (err: unknown) {
    const pgErr = err as { code?: string };
    if (pgErr.code === "42501" || pgErr.code === "23503") {
      return jsonResponse(404, { error: "Nie znaleziono aplikacji." });
    }
    // eslint-disable-next-line no-console
    console.error("Failed to create note", err);
    return jsonResponse(500, { error: "Nie udało się dodać notatki." });
  }
};
