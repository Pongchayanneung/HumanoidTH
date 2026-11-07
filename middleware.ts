import { NextRequest, NextResponse } from "next/server";

const protectedPrefixes = ["/admin", "/data-pulls", "/database"];
const protectedApiPrefixes = ["/api/ingest", "/api/export"];

function isProtectedPath(pathname: string) {
  return protectedPrefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

function isProtectedApiPath(pathname: string) {
  return protectedApiPrefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // 1. Protect Web Pages (Redirect to actual UI login page)
  if (isProtectedPath(pathname)) {
    const adminSession = request.cookies.get("admin_session")?.value;
    if (adminSession !== "true") {
      const loginUrl = new URL("/admin-login", request.url);
      loginUrl.searchParams.set("from", pathname);
      return NextResponse.redirect(loginUrl);
    }
    return NextResponse.next();
  }

  // 2. Protect API Routes (Return 401 JSON without WWW-Authenticate header to prevent browser popups)
  if (isProtectedApiPath(pathname)) {
    const expectedUser = process.env.ADMIN_BASIC_USER;
    const expectedPassword = process.env.ADMIN_BASIC_PASSWORD;

    if (!expectedUser || !expectedPassword) {
      return new NextResponse(JSON.stringify({ error: "Service unavailable: admin credentials not configured." }), {
        status: 503,
        headers: { "Content-Type": "application/json" }
      });
    }

    const header = request.headers.get("authorization");
    if (header?.startsWith("Basic ")) {
      try {
        const [user, password] = atob(header.slice("Basic ".length)).split(":");
        if (user === expectedUser && password === expectedPassword) {
          return NextResponse.next();
        }
      } catch {
        // Fall through to 401
      }
    }

    return new NextResponse(JSON.stringify({ error: "Unauthorized. Admin credentials required." }), {
      status: 401,
      headers: { "Content-Type": "application/json" }
    });
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/admin/:path*",
    "/data-pulls/:path*",
    "/database/:path*",
    "/database",
    "/api/ingest/:path*",
    "/api/export",
    "/api/export/:path*"
  ]
};
