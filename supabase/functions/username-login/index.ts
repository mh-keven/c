import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const allowedOrigins = new Set([
  "https://mh-keven.github.io",
  "http://localhost:5173",
  "http://127.0.0.1:5500",
]);

const usernameEmails: Record<string, string> = {
  "zek123": "keven@anonyms.local",
  "zubii": "zubii@anonyms.local",
};

function responseHeaders(origin: string | null) {
  const allowedOrigin = origin && allowedOrigins.has(origin) ? origin : "https://mh-keven.github.io";
  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  };
}

Deno.serve(async (request: Request) => {
  const origin = request.headers.get("origin");
  const headers = responseHeaders(origin);

  if (request.method === "OPTIONS") {
    return new Response("ok", { headers });
  }
  if (request.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed." }), { status: 405, headers });
  }
  if (origin && !allowedOrigins.has(origin)) {
    return new Response(JSON.stringify({ error: "Origin not allowed." }), { status: 403, headers });
  }

  try {
    const body = await request.json();
    const username = typeof body?.username === "string" ? body.username.trim().toLowerCase() : "";
    const password = typeof body?.password === "string" ? body.password : "";

    if (!username || !password || username.length > 64 || password.length > 256) {
      return new Response(JSON.stringify({ error: "Enter your username and password." }), { status: 400, headers });
    }

    const email = usernameEmails[username];
    if (!email) {
      return new Response(JSON.stringify({ error: "Invalid username or password." }), { status: 401, headers });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    if (!supabaseUrl || !anonKey) {
      console.error("Missing SUPABASE_URL or SUPABASE_ANON_KEY function environment variable.");
      return new Response(JSON.stringify({ error: "Login is temporarily unavailable." }), { status: 500, headers });
    }

    const supabase = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error || !data.session || !data.user) {
      return new Response(JSON.stringify({ error: "Invalid username or password." }), { status: 401, headers });
    }

    const displayName = username === "zek123" ? "Keven" : "Zubii";
    return new Response(JSON.stringify({
      user: { id: data.user.id, username: displayName },
      session: data.session,
    }), { status: 200, headers });
  } catch {
    return new Response(JSON.stringify({ error: "Invalid request." }), { status: 400, headers });
  }
});
