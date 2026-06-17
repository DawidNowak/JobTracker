import { createServerClient } from "@supabase/ssr";

/**
 * Signs in via @supabase/ssr and returns a Cookie header string ready to pass
 * to Astro endpoint requests.  Uses the same createServerClient path as
 * src/lib/supabase.ts so the cookie names/format match what the middleware reads.
 */
export async function signInAndCaptureCookies(email: string, password: string): Promise<string> {
  const supabaseUrl = process.env.SUPABASE_URL ?? "";
  const supabaseKey = process.env.SUPABASE_KEY ?? "";

  const cookieStore = new Map<string, string>();

  const client = createServerClient(supabaseUrl, supabaseKey, {
    cookies: {
      getAll() {
        return Array.from(cookieStore.entries()).map(([name, value]) => ({ name, value }));
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => cookieStore.set(name, value));
      },
    },
  });

  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) {
    throw new Error(`signInAndCaptureCookies: signInWithPassword failed — ${error.message}`);
  }

  if (cookieStore.size === 0) {
    throw new Error("signInAndCaptureCookies: no cookies captured after sign-in — @supabase/ssr setAll was not called");
  }

  return Array.from(cookieStore.entries())
    .map(([name, value]) => `${name}=${value}`)
    .join("; ");
}
