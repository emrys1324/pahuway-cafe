import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/** Rider-only address, e.g. rider.padaya.online (any host starting with "rider."). */
const isRiderHost = (host: string | null) => !!host && host.toLowerCase().startsWith("rider.");
/** Paths the rider address may serve as-is (rider pages, APIs, assets, offline page). */
const RIDER_OK = /^\/(rider(\/|$)|api\/|_next\/|icons\/|sw\.js$|offline\.html$|favicon|apple-touch-icon)/;
/** Pages whose Supabase session is kept fresh. */
const SESSION_PATHS = /^\/(admin|rider|account|login|checkout|api)(\/|$)/;

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // rider.padaya.online → the rider pages only
  if (isRiderHost(request.headers.get("host"))) {
    if (pathname === "/") return withSession(request, NextResponse.rewrite(new URL("/rider", request.url), { request }));
    if (pathname === "/login") return NextResponse.redirect(sameHost(request, "/rider/login"));
    if (!RIDER_OK.test(pathname)) {
      const main = process.env.NEXT_PUBLIC_SITE_URL;
      if (main) return NextResponse.redirect(new URL(pathname + request.nextUrl.search, main));
      return NextResponse.redirect(sameHost(request, "/rider"));
    }
  }

  if (!SESSION_PATHS.test(pathname)) return NextResponse.next();
  return withSession(request, NextResponse.next({ request }));
}

/** An absolute URL on the host the visitor used (not the server's internal address). */
function sameHost(request: NextRequest, path: string) {
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? request.nextUrl.host;
  const proto = request.headers.get("x-forwarded-proto") ?? request.nextUrl.protocol.replace(":", "");
  return new URL(path, `${proto}://${host}`);
}

/** Keeps the Supabase auth session fresh on staff/rider/account pages. */
async function withSession(request: NextRequest, initial: NextResponse) {
  let response = initial;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return response;
  const rewrite = response.headers.get("x-middleware-rewrite");
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (toSet) => {
        toSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = rewrite ? NextResponse.rewrite(new URL(rewrite, request.url), { request }) : NextResponse.next({ request });
        toSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });
  await supabase.auth.getUser();
  return response;
}

export const config = {
  // everything except static build files and images (the rider address needs "/" too)
  matcher: ["/((?!_next/static|_next/image|.*\\.(?:png|jpg|jpeg|webp|svg|ico)$).*)"],
};
