import { NextRequest, NextResponse } from "next/server";
import { verifyAdminSession } from "@/lib/auth";

const protectedPrefixes = ["/admin", "/data-pulls"];
const protectedApiPrefixes = ["/api/ingest", "/api/export"];

function isProtectedPath(pathname: string) {
  return protectedPrefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

function isProtectedApiPath(pathname: string) {
  return protectedApiPrefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // 1. Protect Web Pages (Redirect to actual UI login page)
  if (isProtectedPath(pathname)) {
    const token = request.cookies.get("admin_session")?.value;
    const email = await verifyAdminSession(token);
    if (!email) {
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
      return new NextResponse(JSON.stringify({ error: "Admin credentials are not configured on the server." }), {
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
  matcher: ["/admin/:path*", "/data-pulls/:path*", "/api/ingest/:path*", "/api/export"]
};
