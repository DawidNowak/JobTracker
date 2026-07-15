import type { APIRoute } from "astro";
import { z } from "zod";
import { createClient } from "@/lib/supabase";
import { archiveApplication, getOwnedApplicationState } from "@/lib/services/applications";
import { jsonResponse } from "@/lib/http";

export const prerender = false;

const uuidSchema = z.uuid();

export const POST: APIRoute = async (context) => {
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
    const row = await archiveApplication(supabase, idParam, user.id);
    if (row) {
      return jsonResponse(200, { application: row });
    }

    const owned = await getOwnedApplicationState(supabase, idParam, user.id);
    if (!owned) {
      return jsonResponse(404, { error: "Nie znaleziono aplikacji." });
    }
    if (owned.archived_at !== null) {
      return jsonResponse(422, { error: "Aplikacja została już odrzucona." });
    }
    return jsonResponse(422, {
      error: 'Ofertę z kolumny „Interesujące" można tylko usunąć lub przenieść do „Zaaplikowano".',
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("Failed to archive application", err);
    return jsonResponse(500, { error: "Nie udało się odrzucić aplikacji." });
  }
};
