import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/lib/env";

const publicPaths = new Set(["/login"]);

export async function updateSession(request: NextRequest) {
  // Skip cookie auth for this exact route; the handler checks a server-only bearer secret.
  if (request.nextUrl.pathname === "/api/operations/recovery") return NextResponse.next({ request });
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll(cookiesToSet, headersToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
          Object.entries(headersToSet).forEach(([key, value]) =>
            response.headers.set(key, value),
          );
        },
      },
    },
  );

  const { data } = await supabase.auth.getClaims();
  const pathname = request.nextUrl.pathname;
  const isPublic = publicPaths.has(pathname) || pathname.startsWith("/auth/");

  if (!data?.claims && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  if (data?.claims && pathname === "/login") {
    return NextResponse.redirect(new URL("/auto", request.url));
  }

  return response;
}

