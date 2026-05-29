import type { APIRoute } from "astro";
import { z } from "zod";
import { createClient } from "@/lib/supabase";
import { applicationCreateSchema } from "@/lib/validation/applications";
import { createApplication } from "@/lib/services/applications";

export const prerender = false;

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function formatApplicationErrors(error: z.ZodError): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path[0];
    if (typeof key !== "string" || key in errors) continue;
    if (key === "source" && (issue.code === "too_small" || issue.code === "invalid_type")) {
      errors[key] = "Źródło jest wymagane.";
    } else {
      errors[key] = issue.message;
    }
  }
  return errors;
}

export const POST: APIRoute = async (context) => {
  let body: unknown;
  try {
    body = await context.request.json();
  } catch {
    return jsonResponse(400, { error: "Invalid JSON body." });
  }

  const parsed = applicationCreateSchema.safeParse(body);
  if (!parsed.success) {
    return jsonResponse(422, { errors: formatApplicationErrors(parsed.error) });
  }

  const user = context.locals.user;
  if (!user) {
    return jsonResponse(401, { error: "Unauthorized." });
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return jsonResponse(500, { error: "Supabase is not configured." });
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
