import { cookies } from "next/headers";

export type OperatorPrincipal = Readonly<{ kind: "operator"; email: string }>;

export type SessionResult =
  | { ok: true; principal: OperatorPrincipal }
  | { ok: false; code: "UNAUTHENTICATED" | "UNAVAILABLE" };

/**
 * Resolves the authenticated operator session principal.
 * Integrates with #36 operator session infrastructure when present.
 * Unsigned cookies (admin_session, user_role, user_email) are strictly ignored and never grant operator access.
 * Always fails closed if unauthenticated.
 */
export async function getOperatorPrincipal(customCookies?: any): Promise<SessionResult> {
  try {
    const cookieStore = customCookies ?? (await cookies());

    // Verified operator session token check (__Host-operator_session or operator_session_dev)
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
        return { ok: false, code: "UNAVAILABLE" };
      }
    }

    return { ok: false, code: "UNAUTHENTICATED" };
  } catch {
    return { ok: false, code: "UNAVAILABLE" };
  }
}
