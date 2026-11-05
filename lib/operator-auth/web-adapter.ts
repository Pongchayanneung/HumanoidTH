import type { OperatorConfig } from "./config";
import type { LoginResult, RevokeResult, SessionResult, SignInResult, SignOutResult } from "./contracts";
export type CookieOptions = { httpOnly: boolean; secure: boolean; sameSite: "strict"; path: "/"; maxAge: number; expires: Date };
export type AuthCookieJar = { get(name: string): { value: string } | undefined; set(name: string, value: string, options: CookieOptions): unknown };
export function sessionCookieName(config: OperatorConfig): string { return config.production ? "__Host-operator_session" : "operator_session_dev"; }
export function sessionCookieOptions(config: OperatorConfig, expiresAt: Date): CookieOptions { return { httpOnly: true, secure: config.secureCookie, sameSite: "strict", path: "/", maxAge: 14400, expires: expiresAt }; }
export function createOperatorWebAdapter(dependencies: {
  config: () => OperatorConfig | null;
  core: { loginOperator(input: { email: string; password: string }): Promise<LoginResult>; readOperatorSession(token?: string): Promise<SessionResult>; revokeOperatorSession(token?: string): Promise<RevokeResult> };
  cookies: () => Promise<AuthCookieJar>;
  headers: () => Promise<{ get(name: string): string | null }>;
}) {
  return {
    async signInOperator(input: { email: string; password: string }): Promise<SignInResult> {
      try {
        const config = dependencies.config();
        if (!config) return { ok: false, code: "UNAVAILABLE" };
        if ((await dependencies.headers()).get("origin") !== config.origin) return { ok: false, code: "FORBIDDEN_ORIGIN" };
        const jar = await dependencies.cookies();
        const result = await dependencies.core.loginOperator(input);
        if (!result.ok) return result;
        jar.set(sessionCookieName(config), result.token, sessionCookieOptions(config, result.expiresAt));
        clearLegacyCookies(jar, config);
        return { ok: true };
      } catch { return { ok: false, code: "UNAVAILABLE" }; }
    },
    async signOutOperator(): Promise<SignOutResult> {
      try {
        const config = dependencies.config();
        if (!config) return { ok: false, code: "UNAVAILABLE" };
        if ((await dependencies.headers()).get("origin") !== config.origin) return { ok: false, code: "FORBIDDEN_ORIGIN" };
        const jar = await dependencies.cookies();
        const result = await dependencies.core.revokeOperatorSession(jar.get(sessionCookieName(config))?.value);
        if (!result.ok) return result;
        jar.set(sessionCookieName(config), "", deletionOptions(config));
        clearLegacyCookies(jar, config);
        return { ok: true };
      } catch { return { ok: false, code: "UNAVAILABLE" }; }
    },
    async getOperatorPrincipal(): Promise<SessionResult> {
      try {
        const config = dependencies.config();
        if (!config) return { ok: false, code: "UNAVAILABLE" };
        const jar = await dependencies.cookies();
        return await dependencies.core.readOperatorSession(jar.get(sessionCookieName(config))?.value);
      } catch { return { ok: false, code: "UNAVAILABLE" }; }
    }
  };
}

function deletionOptions(config: OperatorConfig): CookieOptions { return { ...sessionCookieOptions(config, new Date(0)), maxAge: 0 }; }
function clearLegacyCookies(jar: AuthCookieJar, config: OperatorConfig): void {
  for (const name of ["user_email", "user_role", "admin_session"]) jar.set(name, "", deletionOptions(config));
}
