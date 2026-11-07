/** Shared types only: importing these contracts never initializes storage. */
export type OperatorPrincipal = Readonly<{ kind: "operator"; email: string }>;

export type LoginResult =
  | { ok: true; token: string; expiresAt: Date }
  | { ok: false; code: "INVALID_CREDENTIALS" | "THROTTLED" | "UNAVAILABLE"; retryAfterSeconds?: number };

export type SessionResult =
  | { ok: true; principal: OperatorPrincipal }
  | { ok: false; code: "UNAUTHENTICATED" | "UNAVAILABLE" };

export type SignInResult =
  | { ok: true }
  | { ok: false; code: "INVALID_CREDENTIALS" | "THROTTLED" | "UNAVAILABLE" | "FORBIDDEN_ORIGIN"; retryAfterSeconds?: number };

export type SignOutResult =
  | { ok: true }
  | { ok: false; code: "UNAVAILABLE" | "FORBIDDEN_ORIGIN" };

export type WorkflowUnavailable = { ok: false; code: "WORKFLOW_UNAVAILABLE" };

export type RevokeResult = { ok: true } | { ok: false; code: "UNAVAILABLE" };
