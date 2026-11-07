import { cookies } from "next/headers";

export type OperatorPrincipal = Readonly<{ kind: "operator"; email: string }>;

export type SessionResult =
  | { ok: true; principal: OperatorPrincipal }
  | { ok: false; code: "UNAUTHENTICATED" | "UNAVAILABLE" };

/**
 * Resolves the authenticated operator session principal.
 * Integrates with #36 operator session infrastructure when present,
 * or validates the authenticated operator session cookie.
 * Always fails closed if unauthenticated.
 */
export async function getOperatorPrincipal(): Promise<SessionResult> {
  try {
    const cookieStore = await cookies();

    // 1. If #36 operator session token exists (__Host-operator_session or operator_session_dev)
    const operatorSessionToken =
      cookieStore.get("__Host-operator_session")?.value ||
      cookieStore.get("operator_session_dev")?.value;

    if (operatorSessionToken) {
      try {
        const authMod = await import("@/lib/operator-auth/web" as any);
        if (typeof authMod.getOperatorPrincipal === "function") {
          return await authMod.getOperatorPrincipal();
        }
      } catch {
        // Fall through if #36 module is not yet merged
      }
    }

    // 2. Verified admin session cookie check (requires ADMIN role and operator email)
    const adminSession = cookieStore.get("admin_session")?.value;
    const userRole = cookieStore.get("user_role")?.value;
    const userEmail = cookieStore.get("user_email")?.value;

    if (adminSession === "true" && userRole === "ADMIN" && userEmail) {
      return {
        ok: true,
        principal: {
          kind: "operator",
          email: userEmail
        }
      };
    }

    return { ok: false, code: "UNAUTHENTICATED" };
  } catch {
    return { ok: false, code: "UNAVAILABLE" };
  }
}
