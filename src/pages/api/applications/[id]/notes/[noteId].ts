import type { APIRoute } from "astro";
import { z } from "zod";
import { createClient } from "@/lib/supabase";
import { applicationNoteUpdateSchema } from "@/lib/validation/applications";
import { updateNote, deleteNote } from "@/lib/services/notes";
import { jsonResponse, formatZodErrors } from "@/lib/http";

export const prerender = false;

const uuidSchema = z.uuid();

export const PATCH: APIRoute = async (context) => {
  const user = context.locals.user;
  if (!user) {
    return jsonResponse(401, { error: "Brak autoryzacji." });
  }

  const idParam = context.params.id;
  const noteIdParam = context.params.noteId;
  if (
    !idParam ||
    !uuidSchema.safeParse(idParam).success ||
    !noteIdParam ||
    !uuidSchema.safeParse(noteIdParam).success
  ) {
    return jsonResponse(400, { error: "Nieprawidłowy identyfikator." });
  }

  let body: unknown;
  try {
    body = await context.request.json();
  } catch {
    return jsonResponse(400, { error: "Nieprawidłowe żądanie." });
  }

  const parsed = applicationNoteUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return jsonResponse(422, { errors: formatZodErrors(parsed.error) });
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return jsonResponse(500, { error: "Supabase nie jest skonfigurowany." });
  }

  try {
    const note = await updateNote(supabase, noteIdParam, parsed.data.body, user.id);
    if (!note) {
      return jsonResponse(404, { error: "Nie znaleziono notatki." });
    }
    return jsonResponse(200, { note });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("Failed to update note", err);
    return jsonResponse(500, { error: "Nie udało się zaktualizować notatki." });
  }
};

export const DELETE: APIRoute = async (context) => {
  const user = context.locals.user;
  if (!user) {
    return jsonResponse(401, { error: "Brak autoryzacji." });
  }

  const idParam = context.params.id;
  const noteIdParam = context.params.noteId;
  if (
    !idParam ||
    !uuidSchema.safeParse(idParam).success ||
    !noteIdParam ||
    !uuidSchema.safeParse(noteIdParam).success
  ) {
    return jsonResponse(400, { error: "Nieprawidłowy identyfikator." });
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return jsonResponse(500, { error: "Supabase nie jest skonfigurowany." });
  }

  try {
    const deleted = await deleteNote(supabase, noteIdParam, user.id);
    if (!deleted) {
      return jsonResponse(404, { error: "Nie znaleziono notatki." });
    }
    return jsonResponse(200, { ok: true });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("Failed to delete note", err);
    return jsonResponse(500, { error: "Nie udało się usunąć notatki." });
  }
};
