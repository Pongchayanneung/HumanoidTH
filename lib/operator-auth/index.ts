import type { LoginResult, RevokeResult, SessionResult } from "./contracts";

// T0 deliberately denies authority until T1 supplies the verified implementation.
export async function loginOperator(_input: { email: string; password: string }): Promise<LoginResult> {
  return { ok: false, code: "UNAVAILABLE" };
}

export async function readOperatorSession(_token?: string): Promise<SessionResult> {
  return { ok: false, code: "UNAVAILABLE" };
}

export async function revokeOperatorSession(_token?: string): Promise<RevokeResult> {
  return { ok: false, code: "UNAVAILABLE" };
}
