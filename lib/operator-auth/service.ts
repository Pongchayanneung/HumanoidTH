import { createHash, randomBytes } from "node:crypto";
import type { OperatorConfig, ParsedPasswordHash } from "./config";
import { normalizeOperatorEmail } from "./config";
import { DerivationQueue, processDerivationQueue, verifyOperatorPassword } from "./credentials";
import type { OperatorAuthStore } from "./store";
import type { LoginResult, RevokeResult, SessionResult } from "./contracts";

export function tokenDigest(token: string): string { return createHash("sha256").update(token).digest("hex"); }
export function isSessionToken(token: unknown): token is string { return typeof token === "string" && /^[a-f0-9]{64}$/.test(token); }

export function createOperatorAuthService(dependencies: {
  config: () => OperatorConfig | null;
  store: () => Promise<OperatorAuthStore>;
  verifyPassword?: (password: string, hash: ParsedPasswordHash) => Promise<boolean>;
  derivationQueue?: DerivationQueue;
}) {
  return {
    async loginOperator(input: { email: string; password: string }): Promise<LoginResult> {
      try {
        const config = dependencies.config();
        if (!config) return { ok: false, code: "UNAVAILABLE" };
        // Reject oversized/untyped input before storage or KDF work. Never trim passwords.
        if (!input || typeof input.email !== "string" || input.email.length > 254 || typeof input.password !== "string" || Buffer.byteLength(input.password, "utf8") > 1024) return { ok: false, code: "INVALID_CREDENTIALS" };
        const store = await dependencies.store();
        const admission = await store.reserveAttempt(config.fingerprint);
        if (admission.kind === "INACTIVE") return { ok: false, code: "UNAVAILABLE" };
        if (admission.kind === "THROTTLED") return { ok: false, code: "THROTTLED", retryAfterSeconds: admission.retryAfterSeconds };
        const valid = await (dependencies.derivationQueue ?? processDerivationQueue).run(() => (dependencies.verifyPassword ?? verifyOperatorPassword)(input.password, config.parsedHash));
        if (!valid || normalizeOperatorEmail(input.email) !== config.email) return { ok: false, code: "INVALID_CREDENTIALS" };
        const token = randomBytes(32).toString("hex");
        const expiresAt = await store.issueSession({ fingerprint: config.fingerprint, tokenHash: tokenDigest(token) });
        return expiresAt ? { ok: true, token, expiresAt } : { ok: false, code: "UNAVAILABLE" };
      } catch { return { ok: false, code: "UNAVAILABLE" }; }
    },
    async readOperatorSession(token?: string): Promise<SessionResult> {
      try {
        const config = dependencies.config();
        if (!config) return { ok: false, code: "UNAVAILABLE" };
        if (!isSessionToken(token)) return { ok: false, code: "UNAUTHENTICATED" };
        const valid = await (await dependencies.store()).readSession({ fingerprint: config.fingerprint, tokenHash: tokenDigest(token) });
        return valid ? { ok: true, principal: { kind: "operator", email: config.email } } : { ok: false, code: "UNAUTHENTICATED" };
      } catch { return { ok: false, code: "UNAVAILABLE" }; }
    },
    async revokeOperatorSession(token?: string): Promise<RevokeResult> {
      try {
        if (!dependencies.config()) return { ok: false, code: "UNAVAILABLE" };
        if (!isSessionToken(token)) return { ok: true };
        await (await dependencies.store()).revokeSession(tokenDigest(token));
        return { ok: true };
      } catch { return { ok: false, code: "UNAVAILABLE" }; }
    }
  };
}
