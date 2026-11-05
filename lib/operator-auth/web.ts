import type { SessionResult, SignInResult, SignOutResult } from "./contracts";

// This server adapter owns cookie/header access when implemented in T1.
// Its public contract never exposes raw session tokens to callers.
export async function signInOperator(_input: { email: string; password: string }): Promise<SignInResult> {
  return { ok: false, code: "UNAVAILABLE" };
}

export async function signOutOperator(): Promise<SignOutResult> {
  return { ok: false, code: "UNAVAILABLE" };
}

export async function getOperatorPrincipal(): Promise<SessionResult> {
  return { ok: false, code: "UNAVAILABLE" };
}
